import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildGraph, directPath, edgesNearReports, nearestNode, planRoutes } from './lib/model.js';
import { fetchLiveRain } from './lib/liveRain.js';
import { loadReports, saveReports } from './lib/reports.js';
import MapView from './components/MapView.jsx';
import PlaceSearch from './components/PlaceSearch.jsx';
import RainGauge, { rainWord } from './components/RainGauge.jsx';
import ReportDialog from './components/ReportDialog.jsx';
import TripToken, { tripHeadline } from './components/TripToken.jsx';
import { useSheetDrag } from './components/useSheetDrag.js';

const PINNED = 'Point on the map';
const MY_LOCATION = 'My location';
const DEFAULT_TRIP = [
  { name: 'Guindy', lat: 13.00871, lon: 80.22036 },
  { name: 'Tambaram', lat: 12.92453, lon: 80.11505 },
];

function useCityData() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([fetch('/data/meta.json').then((r) => r.json()), fetch('/data/graph.bin').then((r) => r.arrayBuffer())])
      .then(([meta, buffer]) => live && setData({ meta, graph: buildGraph(buffer, meta) }))
      .catch((problem) => {
        console.error('Could not load the road data', problem);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return { data, failed };
}

function Planner({ meta, graph }) {
  const [rain, setRain] = useState(60);
  const [from, setFrom] = useState(DEFAULT_TRIP[0]);
  const [to, setTo] = useState(DEFAULT_TRIP[1]);
  const [night, setNight] = useState(false);
  const [picking, setPicking] = useState(null);
  const [reports, setReports] = useState(loadReports);
  const [draft, setDraft] = useState(null);
  const [notice, setNotice] = useState('');
  const [loadingRain, setLoadingRain] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);

  const sheetDrag = useSheetDrag({
    onTap: () => setSheetFull((open) => !open),
    onRelease: (dy, velocity) => {
      if (velocity < -0.4 || dy < -60) setSheetFull(true);
      else if (velocity > 0.4 || dy > 60) setSheetFull(false);
    },
  });

  useEffect(() => {
    if (!saveReports(reports)) setNotice('This browser is out of storage, so new reports will be lost on reload.');
  }, [reports]);

  const reportedEdges = useMemo(() => edgesNearReports(graph, reports), [graph, reports]);
  const fromNode = useMemo(() => nearestNode(graph, from.lat, from.lon), [graph, from]);
  const toNode = useMemo(() => nearestNode(graph, to.lat, to.lon), [graph, to]);
  const direct = useMemo(() => directPath(graph, fromNode, toNode), [graph, fromNode, toNode]);
  // The map follows the gauge instantly; a citywide route waits until the drag pauses.
  const [routeRain, setRouteRain] = useState(rain);
  useEffect(() => {
    const timer = setTimeout(() => setRouteRain(rain), 140);
    return () => clearTimeout(timer);
  }, [rain]);
  const routes = useMemo(
    () => planRoutes(graph, fromNode, toNode, routeRain, reportedEdges, direct),
    [graph, fromNode, toNode, routeRain, reportedEdges, direct],
  );

  const handlePick = useCallback((mode, lat, lon) => {
    setPicking(null);
    if (mode === 'report') setDraft({ lat, lon });
    else if (mode === 'from') setFrom({ name: PINNED, lat, lon });
    else setTo({ name: PINNED, lat, lon });
  }, []);

  const handleOffline = useCallback(() => setNotice('The base map is offline, so only our road data is showing.'), []);

  const togglePicking = (mode) => {
    setPicking((current) => (current === mode ? null : mode));
    setSheetFull(false);
  };

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setNotice('This browser cannot share your location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { s, n, w, e } = meta.bbox;
        if (coords.latitude < s || coords.latitude > n || coords.longitude < w || coords.longitude > e) {
          setNotice('You are outside the Chennai area this map covers.');
          return;
        }
        setFrom({ name: MY_LOCATION, lat: coords.latitude, lon: coords.longitude });
      },
      () => setNotice('Your location is unavailable. Search for a place or pick one on the map.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [meta]);

  async function applyLiveRain() {
    setLoadingRain(true);
    try {
      const live = await fetchLiveRain(from.lat, from.lon);
      setRain(live);
      setNotice(`Live rain near your start: ${live.toFixed(1)} mm per hour.`);
    } catch {
      setNotice('Live rain is unavailable. Check the connection, or set the rain with the gauge.');
    } finally {
      setLoadingRain(false);
    }
  }

  function addReport(photo) {
    setReports((current) => [...current, { ...draft, photo, time: Date.now() }]);
    setDraft(null);
  }

  const removeReport = useCallback((report) => {
    setReports((current) => current.filter((r) => r !== report));
  }, []);

  const sheetY = sheetFull
    ? `${Math.max(0, sheetDrag.offset)}px`
    : `calc(100% - var(--peek) + ${sheetDrag.offset}px)`;

  return (
    <div className="app" data-theme={night ? 'night' : undefined}>
      <aside
        className={`counter ${sheetDrag.dragging ? '' : 'sheet-motion'}`}
        style={{ '--sheet-y': sheetY }}
        aria-label="Plan a flood-safe trip"
      >
        <div className="sheet-peek" {...sheetDrag.bind}>
          <span className="sheet-handle" />
          <p className="peek-title">{tripHeadline(routes)}</p>
          <p className="meta dim">
            {Math.round(rain)} mm per hour · {rainWord(rain)}
          </p>
        </div>

        <header className="brand">
          <h1>
            Mazhai <span lang="ta">மழை</span>
          </h1>
          <p className="meta dim">Flood-safe routes for Chennai</p>
        </header>

        <div className="sittings" role="group" aria-label="Map theme">
          {[false, true].map((isNight) => (
            <button
              key={String(isNight)}
              type="button"
              aria-pressed={night === isNight}
              data-night={isNight}
              onClick={() => setNight(isNight)}
            >
              {isNight ? 'Night' : 'Day'}
              <span className="meta">{isNight ? 'Dark map' : 'Light map'}</span>
            </button>
          ))}
        </div>

        <RainGauge rain={rain} onChange={setRain} onLive={applyLiveRain} loadingLive={loadingRain} />

        <section className="trip" aria-label="Trip">
          <PlaceSearch
            label="From"
            value={from}
            places={meta.places}
            picking={picking === 'from'}
            onSelect={setFrom}
            onPickOnMap={() => togglePicking('from')}
          />
          <PlaceSearch
            label="To"
            value={to}
            places={meta.places}
            picking={picking === 'to'}
            onSelect={setTo}
            onPickOnMap={() => togglePicking('to')}
          />
          <button
            type="button"
            className="menu-tag swap"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            Swap start and destination
          </button>
        </section>

        <TripToken routes={routes} />

        {reports.length > 0 && (
          <button type="button" className="menu-tag" onClick={() => setReports([])}>
            Clear {reports.length} flood {reports.length === 1 ? 'report' : 'reports'}
          </button>
        )}

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}

        <footer className="legend">
          <ul className="meta">
            <li><i className="swatch swatch-rising" /> Water rising</li>
            <li><i className="swatch swatch-deep" /> Deeper water</li>
            <li><i className="swatch swatch-flooded" /> Flooded</li>
          </ul>
          <p>What-if estimate from ground height and past flooding, not a forecast. Never drive or walk into moving water.</p>
        </footer>
      </aside>

      <main className="stage">
        <MapView
          meta={meta}
          graph={graph}
          rain={rain}
          routes={routes}
          from={from}
          to={to}
          reports={reports}
          reportedEdges={reportedEdges}
          night={night}
          picking={picking}
          onPick={handlePick}
          onLocate={locate}
          onOffline={handleOffline}
          onRemoveReport={removeReport}
        />
        <div className="map-actions">
          <button
            type="button"
            className="btn btn-tangerine"
            aria-pressed={picking === 'report'}
            onClick={() => togglePicking('report')}
          >
            {picking === 'report' ? 'Tap the flooded spot' : '+ Report flooding'}
          </button>
        </div>
        <div className="map-brand" aria-hidden="true">
          Mazhai <span lang="ta">மழை</span>
        </div>
      </main>

      {draft && <ReportDialog onSave={addReport} onCancel={() => setDraft(null)} />}
    </div>
  );
}

export default function App() {
  const { data, failed } = useCityData();
  if (data) return <Planner meta={data.meta} graph={data.graph} />;
  return (
    <div className="loading">
      <div className="token">
        <h1 className="token-title">
          Mazhai <span lang="ta">மழை</span>
        </h1>
        <p role="status">{failed ? 'The road data did not load. Reload the page to try again.' : "Loading Chennai's roads"}</p>
      </div>
    </div>
  );
}
