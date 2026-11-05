// Rough accuracy check: do places reported as flooded score higher than other neighbourhoods?
// None of these places feed the flood-history boost. Every second name, alphabetically from the first,
// was used to choose the score; the README gives the held-out result for the rest.
// Run with: npm run validate
import { readFileSync } from 'node:fs';
import { AVOID_RISK, RAMP, buildGraph, metres } from '../src/lib/model.js';

const REPORTED_FLOODED = [
  'Mudichur', 'Varadharajapuram', 'Perumbakkam', 'Pallikaranai', 'Velachery', 'Vyasarpadi', 'Taramani',
  'Kolathur', 'West Mambalam', 'T. Nagar', 'Ashok Nagar', 'Nungambakkam', 'Tondiarpet', 'Ambattur',
  'Kodambakkam', 'Mylapore', 'Anna Nagar', 'Madipakkam', 'Medavakkam', 'Kovilambakkam', 'Alwarpet',
  'Kilpauk', 'Perungudi', 'Tambaram',
];
const AREA_M = 500; // a neighbourhood is the roads within this distance of a point
const SPOT_EXCLUSION_M = 1200; // past this, the model's flood-history boost has no effect
const TEST_RAIN = 60;
const CONTROLS = 3000;

const root = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', root)));
const bytes = readFileSync(new URL('graph.bin', root));
const graph = buildGraph(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), meta);

// Seeded, so everyone gets the same result.
let seed = 20261106;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const mid = (e) => [
  (graph.lat[graph.edgeA[e]] + graph.lat[graph.edgeB[e]]) / 2e5,
  (graph.lon[graph.edgeA[e]] + graph.lon[graph.edgeB[e]]) / 2e5,
];

// Roads that the flood-history boost can't reach, bucketed for fast lookups.
const CELL = 0.01;
const cellKey = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;
const cells = new Map();
const usable = [];
for (let e = 0; e < graph.edgeCount; e++) {
  const [lat, lon] = mid(e);
  if (meta.spots.some((s) => metres(lat, lon, s.lat, s.lon) < SPOT_EXCLUSION_M)) continue;
  const road = { lat, lon, score: graph.edgeSus[e] / 255, onset: graph.edgeOnset[e], len: graph.edgeLen[e] };
  usable.push(road);
  const key = cellKey(lat, lon);
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(road);
}

function neighbourhood(lat, lon) {
  const roads = [];
  const y = Math.floor(lat / CELL);
  const x = Math.floor(lon / CELL);
  for (let a = y - 1; a <= y + 1; a++)
    for (let b = x - 1; b <= x + 1; b++)
      for (const road of cells.get(`${a}:${b}`) ?? [])
        if (metres(lat, lon, road.lat, road.lon) <= AREA_M) roads.push(road);
  if (roads.length < 10) return null;
  const total = roads.reduce((sum, r) => sum + r.len, 0);
  const flooded = roads.reduce((sum, r) => sum + ((TEST_RAIN - r.onset) / RAMP >= AVOID_RISK ? r.len : 0), 0);
  return { score: roads.reduce((sum, r) => sum + r.score * r.len, 0) / total, flooded: flooded / total };
}

const tested = [];
for (const name of REPORTED_FLOODED) {
  const place = meta.places.find((p) => p.name === name && p.kind === 'Area');
  const area = place && neighbourhood(place.lat, place.lon);
  if (area) tested.push({ name, ...place, ...area });
  else console.log(`skipped ${name}: ${place ? 'too few usable roads' : 'not found on the map'}`);
}

const controls = [];
while (controls.length < CONTROLS) {
  const road = usable[Math.floor(random() * usable.length)];
  const area = neighbourhood(road.lat, road.lon);
  if (area) controls.push({ ...area, lat: road.lat, lon: road.lon });
}

const beats = (place, group) => {
  const wins = group.reduce((sum, c) => sum + (place.score > c.score ? 1 : place.score === c.score ? 0.5 : 0), 0);
  return wins / group.length;
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

for (const place of tested) {
  place.city = beats(place, controls);
  const nearby = controls.filter((c) => {
    const d = metres(place.lat, place.lon, c.lat, c.lon);
    return d >= 2000 && d <= 6000;
  });
  place.local = beats(place, nearby);
  place.nearbyCount = nearby.length;
}

function interval(key) {
  const samples = [];
  for (let i = 0; i < 4000; i++) {
    samples.push(mean(tested.map(() => tested[Math.floor(random() * tested.length)][key])));
  }
  samples.sort((a, b) => a - b);
  return [samples[100], samples[3899]];
}

const pct = (v) => `${Math.round(v * 100)}%`;
const show = (key) => {
  const [low, high] = interval(key);
  return `${pct(mean(tested.map((p) => p[key])))} (95% range ${pct(low)} to ${pct(high)})`;
};

console.log('\nplace                 score  flooded@60  beats city  beats nearby');
for (const p of [...tested].sort((a, b) => b.city - a.city)) {
  console.log(
    `${p.name.padEnd(21)} ${p.score.toFixed(2)}   ${pct(p.flooded).padStart(6)}      ${pct(p.city).padStart(6)}      ${pct(p.local).padStart(6)}`,
  );
}
console.log(`\nplaces tested: ${tested.length} of ${REPORTED_FLOODED.length}; control neighbourhoods: ${controls.length}`);
console.log('50% means no better than chance.');
console.log(`beats citywide controls: ${show('city')}`);
console.log(`beats controls 2 to 6 km away: ${show('local')}`);
console.log(`road length flagged at ${TEST_RAIN} mm/h: reported places ${pct(mean(tested.map((p) => p.flooded)))}, controls ${pct(mean(controls.map((c) => c.flooded)))}`);
console.log(`reported places flagged on at least 10% of roads: ${tested.filter((p) => p.flooded >= 0.1).length} of ${tested.length}`);
console.log(`controls flagged on at least 10% of roads: ${pct(controls.filter((c) => c.flooded >= 0.1).length / controls.length)}`);
