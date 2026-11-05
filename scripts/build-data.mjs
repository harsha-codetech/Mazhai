// Turns the raw Chennai extracts into the two files the app loads:
//   public/data/graph.bin   road network, packed as typed arrays
//   public/data/meta.json   counts, road names, searchable places
// Run after scripts/extract_osm.py with: npm run build:data
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { BBOX, RAW, STEP, boxBlur, cellAt, cols, elevationGrid, readRaw, rows, toCol, toRow } from './features.mjs';

const MAX_EDGE_M = 300; // long roads are split so they can flood section by section
// Ground at or above HIGH_GROUND scores 0; each metre lower adds 1 / GROUND_RANGE.
// In the accuracy check, absolute ground height was the only measure that beat chance.
const HIGH_GROUND_M = 16;
const GROUND_RANGE_M = 14;
const OUT = new URL('../public/data/', import.meta.url);

// Places reported as flood-prone in news coverage. Sources are listed in the README.
const KNOWN_SPOTS = [
  'Ram Nagar', 'AGS Officers Colony', 'Pallavaram', 'Chromepet', 'Chitlapakkam', 'Periamet',
  'Manali', 'Thiruvottiyur', 'Chintadripet', 'Perambur', 'Perungalathur',
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function metres(aLat, aLon, bLat, bLon) {
  const x = (bLon - aLon) * 111320 * Math.cos((aLat * Math.PI) / 180);
  const y = (bLat - aLat) * 110574;
  return Math.hypot(x, y);
}

function susceptibilityGrid(elev, spots) {
  const grid = elev.map((height) => clamp01((HIGH_GROUND_M - height) / GROUND_RANGE_M));
  const reach = Math.ceil(800 / 100);
  for (const spot of spots) {
    const r0 = toRow(spot.lat);
    const c0 = toCol(spot.lon);
    for (let r = r0 - reach; r <= r0 + reach; r++)
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const d = metres(spot.lat, spot.lon, BBOX.s + r * STEP, BBOX.w + c * STEP);
        const i = r * cols + c;
        grid[i] = Math.max(grid[i], 0.9 * Math.exp(-((d / 350) ** 2)));
      }
  }
  return grid;
}

async function readRoads() {
  const ways = [];
  const lines = createInterface({ input: createReadStream(new URL('roads.ndjson', RAW)) });
  for await (const line of lines) ways.push(JSON.parse(line));
  return ways;
}

const classOf = (h) =>
  /^(motorway|trunk|primary)/.test(h) ? 3 : /^secondary/.test(h) ? 2 : /^tertiary/.test(h) ? 1 : 0;

function buildNetwork(ways, susceptibility, elevation) {
  // OSM nodes shared by ways are the junctions; identical coordinates mean the same node.
  const uses = new Map();
  const key = (p) => p[0] * 1e7 + p[1];
  for (const way of ways)
    way.p.forEach((p, i) => {
      const k = key(p);
      const end = i === 0 || i === way.p.length - 1;
      uses.set(k, (uses.get(k) ?? 0) + (end ? 2 : 1));
    });

  const junctions = new Map();
  const nodes = [];
  const nodeOf = (p) => {
    const k = key(p);
    if (!junctions.has(k)) {
      junctions.set(k, nodes.length);
      nodes.push(p);
    }
    return junctions.get(k);
  };

  const names = [''];
  const nameIndex = new Map([['', 0]]);
  const edges = [];
  for (const way of ways) {
    if (!nameIndex.has(way.n)) {
      nameIndex.set(way.n, names.length);
      names.push(way.n);
    }
    let shape = [way.p[0]];
    let length = 0;
    for (let i = 1; i < way.p.length; i++) {
      const p = way.p[i];
      const q = way.p[i - 1];
      length += metres(q[0], q[1], p[0], p[1]);
      shape.push(p);
      const last = i === way.p.length - 1;
      if (last || uses.get(key(p)) > 1 || length >= MAX_EDGE_M) {
        let s = 0;
        let e = -1000;
        for (const point of shape) {
          s = Math.max(s, cellAt(susceptibility, point[0], point[1]));
          e = Math.max(e, cellAt(elevation, point[0], point[1]));
        }
        // Bridges and flyovers sit above the water; subways are the first to fill.
        if (way.b || /flyover/i.test(way.n) || /bridge$/i.test(way.n)) s = 0;
        if (way.t) s = 1;
        edges.push({
          a: nodeOf(shape[0]),
          b: nodeOf(p),
          len: length,
          cls: classOf(way.h),
          oneway: way.o,
          name: nameIndex.get(way.n),
          s,
          elev: e,
          shape,
        });
        shape = [p];
        length = 0;
      }
    }
  }
  return keepLargestComponent(nodes, edges, names);
}

function keepLargestComponent(nodes, edges, names) {
  const parent = Int32Array.from(nodes, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const e of edges) parent[find(e.a)] = find(e.b);
  const sizes = new Map();
  nodes.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1));
  const biggest = [...sizes.entries()].sort((x, y) => y[1] - x[1])[0][0];

  const remap = new Int32Array(nodes.length).fill(-1);
  const kept = [];
  nodes.forEach((n, i) => {
    if (find(i) === biggest) {
      remap[i] = kept.length;
      kept.push(n);
    }
  });
  const keptEdges = edges.filter((e) => remap[e.a] >= 0 && remap[e.b] >= 0);
  for (const e of keptEdges) {
    e.a = remap[e.a];
    e.b = remap[e.b];
  }
  return { nodes: kept, edges: keptEdges, names };
}

// Drops shape points that barely change the line (about 4 m tolerance).
function simplify(points, tolerance = 0.00004) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0;
    let index = -1;
    const [ay, ax] = points[a];
    const [by, bx] = points[b];
    const length = Math.hypot(by - ay, bx - ax) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i][0]) - (ax - points[i][1]) * (by - ay)) / length;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function packGraph({ nodes, edges }) {
  const n = nodes.length;
  const m = edges.length;
  const shapes = edges.map((e) => simplify(e.shape).slice(1, -1));
  const shapeTotal = shapes.reduce((sum, s) => sum + s.length, 0);

  const nodeLat = new Int32Array(n);
  const nodeLon = new Int32Array(n);
  nodes.forEach((p, i) => {
    nodeLat[i] = Math.round(p[0] * 1e5);
    nodeLon[i] = Math.round(p[1] * 1e5);
  });
  const edgeA = new Uint32Array(m);
  const edgeB = new Uint32Array(m);
  const edgeLen = new Float32Array(m);
  const edgeName = new Uint32Array(m);
  const shapeStart = new Uint32Array(m + 1);
  const shapeLat = new Int32Array(shapeTotal);
  const shapeLon = new Int32Array(shapeTotal);
  const edgeSus = new Uint8Array(m);
  const edgeElev = new Uint8Array(m);
  const edgeFlags = new Uint8Array(m); // bits 0-1 road class, bit 2 one-way

  let at = 0;
  edges.forEach((e, i) => {
    edgeA[i] = e.a;
    edgeB[i] = e.b;
    edgeLen[i] = e.len;
    edgeName[i] = e.name;
    edgeSus[i] = Math.round(clamp01(e.s) * 255);
    edgeElev[i] = Math.max(0, Math.min(255, Math.round(e.elev)));
    edgeFlags[i] = e.cls | (e.oneway << 2);
    shapeStart[i] = at;
    for (const p of shapes[i]) {
      shapeLat[at] = Math.round(p[0] * 1e5);
      shapeLon[at] = Math.round(p[1] * 1e5);
      at++;
    }
  });
  shapeStart[m] = at;

  // 4-byte arrays first so every typed view in the browser stays aligned.
  const parts = [nodeLat, nodeLon, edgeA, edgeB, edgeLen, edgeName, shapeStart, shapeLat, shapeLon, edgeSus, edgeElev, edgeFlags];
  return { buffer: Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))), shapeTotal };
}

function searchablePlaces(raw) {
  const label = { station: 'Station', hospital: 'Hospital', mall: 'Mall', university: 'University', college: 'College', airport: 'Airport', place: 'Area' };
  const seen = new Set();
  const result = [];
  for (const p of raw) {
    const name = p.name.trim();
    const id = `${name.toLowerCase()}:${p.kind}`;
    if (seen.has(id) || p.lat < BBOX.s || p.lat > BBOX.n || p.lon < BBOX.w || p.lon > BBOX.e) continue;
    seen.add(id);
    result.push({ name, kind: label[p.kind], lat: Number(p.lat.toFixed(5)), lon: Number(p.lon.toFixed(5)) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

console.log(`grid ${rows} x ${cols}`);
const elevation = boxBlur(await elevationGrid(['fabdem/N12E080_FABDEM_V1-2.tif', 'fabdem/N13E080_FABDEM_V1-2.tif']), 1);
const rawPlaces = readRaw('places.json');
const spots = KNOWN_SPOTS.flatMap((name) => {
  const found = rawPlaces.filter((p) => p.kind === 'place' && p.name.toLowerCase() === name.toLowerCase());
  if (found.length === 0) console.log(`no location found for known spot: ${name}`);
  // Two Ram Nagars exist in this area; the flood reports mean the one in Velachery.
  const place = name === 'Ram Nagar' ? found.find((p) => Math.abs(p.lat - 12.9654) < 0.002) : found[0];
  return place ? [{ name, lat: place.lat, lon: place.lon }] : [];
});
const susceptibility = susceptibilityGrid(elevation, spots);

const ways = await readRoads();
console.log(`ways ${ways.length}`);
const network = buildNetwork(ways, susceptibility, elevation);
const { buffer, shapeTotal } = packGraph(network);

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('graph.bin', OUT), buffer);
const places = searchablePlaces(rawPlaces);
writeFileSync(
  new URL('meta.json', OUT),
  JSON.stringify({
    bbox: BBOX,
    nodeCount: network.nodes.length,
    edgeCount: network.edges.length,
    shapeCount: shapeTotal,
    names: network.names,
    places,
    spots,
  }),
);

const sorted = network.edges.map((e) => e.s).sort((a, b) => a - b);
const q = (p) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(2);
console.log(`nodes ${network.nodes.length}, edges ${network.edges.length}, shape points ${shapeTotal}`);
console.log(`susceptibility p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)}`);
console.log(`graph.bin ${(buffer.length / 1e6).toFixed(1)} MB, places ${places.length}, spots ${spots.length}`);
