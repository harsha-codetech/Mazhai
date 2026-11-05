import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { AVOID_RISK, RAMP, edgeCoords, metres, nearestNode } from '../lib/model.js';

maplibregl.setWorkerUrl(workerUrl);

const STYLE_DAY = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_NIGHT = 'https://tiles.openfreemap.org/styles/dark';
const FLOOD_DAY = ['#7fb8ea', '#2f7fd6', '#12408f'];
const FLOOD_NIGHT = ['#3b6ea5', '#4f9df0', '#9fd0ff'];

const EMPTY = { type: 'FeatureCollection', features: [] };
const line = (coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
const lines = (coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } });
const ROUND = { 'line-cap': 'round', 'line-join': 'round' };

/** Used when the map style can't be reached, so the demo survives bad venue Wi-Fi. */
function offlineStyle(night) {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'land', type: 'background', paint: { 'background-color': night ? '#1c1c1c' : '#ecebe6' } }],
  };
}

async function loadStyle(url, night) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`Map style returned ${res.status}`);
    return { style: await res.json(), online: true };
  } catch {
    return { style: offlineStyle(night), online: false };
  }
}

// WayLore's base map treatment: both styles are greyscale, so colour water and parks.
function tintMap(map, night) {
  const water = night ? '#1d3a55' : '#a8d4f5';
  const green = night ? '#1f3a28' : '#cde8b5';
  for (const layer of map.getStyle().layers ?? []) {
    const sourceLayer = layer['source-layer'];
    if (sourceLayer === 'water' && layer.type === 'fill') map.setPaintProperty(layer.id, 'fill-color', water);
    else if (sourceLayer === 'waterway' && layer.type === 'line') map.setPaintProperty(layer.id, 'line-color', water);
    else if ((layer.id === 'landcover_wood' || sourceLayer === 'park') && layer.type === 'fill') {
      map.setPaintProperty(layer.id, 'fill-color', green);
      map.setPaintProperty(layer.id, 'fill-opacity', 1);
    }
  }
}

// Roads are grouped by the rain at which they flood, so one GeoJSON source holds the whole
// city in a few dozen features, and moving the gauge only changes a paint expression.
function roadFeatures(graph) {
  const groups = new Map();
  for (let e = 0; e < graph.edgeCount; e++) {
    const onset = Math.round(graph.edgeOnset[e] / 2) * 2;
    const major = (graph.edgeFlags[e] & 3) > 0 ? 1 : 0;
    const key = onset * 2 + major;
    if (!groups.has(key)) groups.set(key, { onset, major, coordinates: [] });
    groups.get(key).coordinates.push(edgeCoords(graph, e));
  }
  return {
    type: 'FeatureCollection',
    features: [...groups.values()].map(({ onset, major, coordinates }) => ({
      type: 'Feature',
      properties: { onset, major },
      geometry: { type: 'MultiLineString', coordinates },
    })),
  };
}

const roadWidth = (scale) => [
  'interpolate', ['linear'], ['zoom'],
  10, ['case', ['==', ['get', 'major'], 1], 1.6 * scale, 0.3 * scale],
  13, ['case', ['==', ['get', 'major'], 1], 3 * scale, 1.2 * scale],
  16, ['case', ['==', ['get', 'major'], 1], 7 * scale, 4 * scale],
];

// One layer per flood onset: moving the gauge only changes constant colours and visibility,
// which is far cheaper than re-evaluating a data-driven colour across a whole city of roads.
function floodColour(onset, rain, night) {
  const [rising, deep, flooded] = night ? FLOOD_NIGHT : FLOOD_DAY;
  const risk = (rain - onset) / RAMP;
  if (risk < 0.15) return null;
  return risk >= AVOID_RISK ? flooded : risk >= 0.35 ? deep : rising;
}

function paintFlood(map, onsets, rain, night) {
  for (const onset of onsets) {
    const colour = floodColour(onset, rain, night);
    const id = `flood-${onset}`;
    map.setLayoutProperty(id, 'visibility', colour ? 'visible' : 'none');
    if (colour) map.setPaintProperty(id, 'line-color', colour);
  }
}

function pinElement(label, tone, ariaLabel) {
  const el = document.createElement('div');
  el.className = 'wl-marker';
  const coin = document.createElement('div');
  coin.className = 'wl-pin';
  coin.dataset.tone = tone;
  coin.setAttribute('role', 'img');
  coin.setAttribute('aria-label', ariaLabel);
  const text = document.createElement('span');
  text.className = 'wl-pin-icon';
  text.textContent = label;
  coin.append(text);
  el.append(coin);
  return el;
}

function roadPopup(graph, lat, lon, reported) {
  const node = nearestNode(graph, lat, lon);
  if (metres(lat, lon, graph.lat[node] / 1e5, graph.lon[node] / 1e5) > 120) return null;
  let edge = -1;
  for (let l = graph.firstLink[node]; l < graph.firstLink[node + 1]; l++) {
    if (edge < 0 || graph.edgeName[graph.linkEdge[l]]) edge = graph.linkEdge[l];
  }
  if (edge < 0) return null;

  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = graph.names[graph.edgeName[edge]] || 'Unnamed road';
  const onset = document.createElement('p');
  onset.textContent = reported.has(edge)
    ? 'Reported flooded'
    : `Estimated to flood from about ${Math.round(graph.edgeOnset[edge])} mm per hour`;
  const height = document.createElement('p');
  height.className = 'meta';
  height.textContent = `Ground height about ${graph.edgeElev[edge]} m`;
  box.append(title, onset, height);
  return box;
}

export default function MapView({ meta, graph, rain, routes, from, to, reports, reportedEdges, night, picking, onPick, onLocate, onOffline, onRemoveReport }) {
  const holder = useRef(null);
  const map = useRef(null);
  const fromPin = useRef(null);
  const toPin = useRef(null);
  const reportPins = useRef([]);
  const [ready, setReady] = useState(0); // bumped each time our layers are (re)added
  const [tilted, setTilted] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const roads = useMemo(() => roadFeatures(graph), [graph]);
  const onsets = useMemo(() => [...new Set(roads.features.map((f) => f.properties.onset))].sort((a, b) => b - a), [roads]);

  const latest = useRef({});
  latest.current = { rain, routes, night, picking, onPick, reportedEdges, onOffline, onRemoveReport };

  function addLayers(instance, online) {
    const { night: isNight } = latest.current;
    tintMap(instance, isNight);
    instance.addSource('roads', { type: 'geojson', data: roads, maxzoom: 15, tolerance: 0.5 });
    instance.addSource('reported', { type: 'geojson', data: EMPTY });
    instance.addSource('direct', { type: 'geojson', data: EMPTY });
    instance.addSource('direct-wet', { type: 'geojson', data: EMPTY });
    instance.addSource('safe', { type: 'geojson', data: EMPTY });

    if (!online) {
      instance.addLayer({
        id: 'roads-base',
        type: 'line',
        source: 'roads',
        layout: ROUND,
        paint: { 'line-color': isNight ? '#555' : '#fff', 'line-width': roadWidth(0.8) },
      });
    }
    for (const onset of onsets) {
      instance.addLayer({
        id: `flood-${onset}`,
        type: 'line',
        source: 'roads',
        filter: ['==', ['get', 'onset'], onset],
        layout: { ...ROUND, visibility: 'none' },
        paint: { 'line-width': roadWidth(1) },
      });
    }
    instance.addLayer({
      id: 'reported',
      type: 'line',
      source: 'reported',
      layout: ROUND,
      paint: { 'line-color': isNight ? FLOOD_NIGHT[2] : FLOOD_DAY[2], 'line-width': 5 },
    });
    instance.addLayer({
      id: 'direct',
      type: 'line',
      source: 'direct',
      layout: ROUND,
      paint: { 'line-color': isNight ? '#f3efe4' : '#1b1b1b', 'line-width': 3, 'line-dasharray': [0.5, 2.5] },
    });
    instance.addLayer({
      id: 'direct-wet',
      type: 'line',
      source: 'direct-wet',
      layout: ROUND,
      paint: { 'line-color': '#ff7548', 'line-width': 6 },
    });
    instance.addLayer({
      id: 'safe-casing',
      type: 'line',
      source: 'safe',
      layout: ROUND,
      paint: { 'line-color': '#1b1b1b', 'line-width': 9 },
    });
    instance.addLayer({
      id: 'safe',
      type: 'line',
      source: 'safe',
      layout: ROUND,
      paint: { 'line-color': '#c9f05a', 'line-width': 5 },
    });
    instance.once('idle', () => setDrawn(true));
    setReady((n) => n + 1);
  }

  useEffect(() => {
    let cancelled = false;
    let instance;
    const { w, s, e, n } = meta.bbox;

    loadStyle(latest.current.night ? STYLE_NIGHT : STYLE_DAY, latest.current.night).then(({ style, online }) => {
      if (cancelled) return;
      if (!online) latest.current.onOffline();
      instance = new maplibregl.Map({
        container: holder.current,
        style,
        bounds: [[w, s], [e, n]],
        maxBounds: [[w - 0.2, s - 0.2], [e + 0.2, n + 0.2]],
        minZoom: 9.5,
        attributionControl: { compact: true, customAttribution: 'Roads © OpenStreetMap contributors · Elevation: FABDEM' },
      });
      instance.once('style.load', () => addLayers(instance, online));
      instance.on('click', ({ lngLat, originalEvent }) => {
        const { picking: mode, onPick: pick, reportedEdges: reported } = latest.current;
        if (mode) {
          pick(mode, lngLat.lat, lngLat.lng);
          return;
        }
        // A tap on a pin belongs to the pin's own popup, not the road underneath it.
        if (originalEvent.target.closest?.('.wl-marker')) return;
        const details = roadPopup(graph, lngLat.lat, lngLat.lng, reported);
        if (details) new maplibregl.Popup({ closeButton: false, maxWidth: '240px' }).setLngLat(lngLat).setDOMContent(details).addTo(instance);
      });
      map.current = instance;
    });

    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
    };
    // The map is created once; everything else is synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, meta]);

  // Day and night swap the whole style, which drops our layers, so they are added again.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const instance = map.current;
    if (!instance) return;
    let cancelled = false;
    loadStyle(night ? STYLE_NIGHT : STYLE_DAY, night).then(({ style, online }) => {
      if (cancelled || !map.current) return;
      instance.once('style.load', () => addLayers(instance, online));
      instance.setStyle(style, { diff: false });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [night]);

  useEffect(() => {
    if (ready && map.current) paintFlood(map.current, onsets, rain, night);
  }, [rain, night, ready, onsets]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const sameRoute = routes?.direct && routes.safe && routes.direct.distance === routes.safe.distance;
    instance.getSource('safe').setData(routes?.safe ? line(routes.safe.coordinates) : EMPTY);
    instance.getSource('direct').setData(routes?.direct && !sameRoute ? line(routes.direct.coordinates) : EMPTY);
    instance.getSource('direct-wet').setData(routes?.direct ? lines(routes.direct.wetLines) : EMPTY);
  }, [routes, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.getSource('reported').setData(lines([...reportedEdges].map((e) => edgeCoords(graph, e))));
  }, [graph, reportedEdges, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    fromPin.current?.remove();
    toPin.current?.remove();
    fromPin.current = new maplibregl.Marker({ element: pinElement('A', 'lime', `Start: ${from.name}`) }).setLngLat([from.lon, from.lat]).addTo(instance);
    toPin.current = new maplibregl.Marker({ element: pinElement('B', 'lime', `Destination: ${to.name}`) }).setLngLat([to.lon, to.lat]).addTo(instance);

    const { clientWidth, clientHeight } = instance.getContainer();
    const narrow = clientWidth < 1024;
    // Frame the whole detour as well as the two pins.
    const bounds = new maplibregl.LngLatBounds([from.lon, from.lat], [from.lon, from.lat]).extend([to.lon, to.lat]);
    for (const point of latest.current.routes?.safe?.coordinates ?? []) bounds.extend(point);
    instance.fitBounds(bounds, {
      padding: narrow ? { top: 80, right: 50, bottom: Math.min(clientHeight * 0.4, 220), left: 50 } : 110,
      maxZoom: 15,
      duration: 700,
    });
  }, [from, to, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    reportPins.current.forEach((marker) => marker.remove());
    reportPins.current = reports.map((report) => {
      const box = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = 'Flooding reported';
      const when = document.createElement('p');
      when.className = 'meta';
      when.textContent = new Date(report.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      box.append(title, when);
      if (report.photo) {
        const image = document.createElement('img');
        image.src = report.photo;
        image.alt = 'Photo of the flooding';
        box.append(image);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'menu-tag popup-action';
      remove.textContent = 'Remove report';
      remove.addEventListener('click', () => latest.current.onRemoveReport(report));
      box.append(remove);
      return new maplibregl.Marker({ element: pinElement('!', 'tangerine', 'Flood report') })
        .setLngLat([report.lon, report.lat])
        .setPopup(new maplibregl.Popup({ closeButton: false, offset: 20 }).setDOMContent(box))
        .addTo(instance);
    });
  }, [reports, ready]);

  function tilt() {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? 55 : 0, bearing: next ? -15 : 0, duration: 700 });
  }

  const zoomBy = (delta) => map.current?.easeTo({ zoom: map.current.getZoom() + delta });

  return (
    <div className="map-wrap">
      <div ref={holder} className={`map ${picking ? 'map-picking' : ''}`} role="region" aria-label="Map of Chennai flood risk" />
      {!drawn && (
        <p className="map-loading meta" role="status">
          Drawing Chennai's roads
        </p>
      )}
      <div className="map-strip">
        <button type="button" className="ctl ctl-wide" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        <button type="button" className="ctl ctl-wide" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
        <button type="button" className="ctl" onClick={onLocate} aria-label="Start from my location">◎</button>
        <button type="button" className="ctl ctl-3d" onClick={tilt} aria-pressed={tilted} aria-label="Tilt the map">3D</button>
      </div>
    </div>
  );
}
