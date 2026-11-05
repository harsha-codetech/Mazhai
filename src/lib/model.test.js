import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, directPath, edgeCoords, edgesNearReports, nearestNode, onsetRain, planRoutes, riskAt } from './model.js';

// Packs a small network in the same layout as scripts/build-data.mjs writes.
function pack(nodes, edges) {
  const n = nodes.length;
  const m = edges.length;
  const shapes = edges.flatMap((e) => e.shape ?? []);
  const parts = [
    Int32Array.from(nodes, (p) => Math.round(p[0] * 1e5)),
    Int32Array.from(nodes, (p) => Math.round(p[1] * 1e5)),
    Uint32Array.from(edges, (e) => e.a),
    Uint32Array.from(edges, (e) => e.b),
    Float32Array.from(edges, (e) => e.len),
    Uint32Array.from(edges, (e) => e.name ?? 0),
  ];
  const start = new Uint32Array(m + 1);
  edges.forEach((e, i) => (start[i + 1] = start[i] + (e.shape?.length ?? 0)));
  parts.push(
    start,
    Int32Array.from(shapes, (p) => Math.round(p[0] * 1e5)),
    Int32Array.from(shapes, (p) => Math.round(p[1] * 1e5)),
    Uint8Array.from(edges, (e) => Math.round((e.s ?? 0) * 255)),
    Uint8Array.from(edges, () => 10),
    Uint8Array.from(edges, (e) => (e.oneway ? 4 : 0)),
  );
  const bytes = Buffer.concat(parts.map((p) => Buffer.from(p.buffer)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  return buildGraph(buffer, {
    nodeCount: n,
    edgeCount: m,
    shapeCount: shapes.length,
    names: ['', 'Low Road', 'High Road'],
  });
}

// A square: 0 -> 1 -> 3 is the short way over wet ground, 0 -> 2 -> 3 the long dry way.
const graph = pack(
  [
    [12.97, 80.2],
    [12.97, 80.201],
    [12.975, 80.2],
    [12.97, 80.202],
  ],
  [
    { a: 0, b: 1, len: 100, s: 1, name: 1, shape: [[12.9701, 80.2005]] },
    { a: 1, b: 3, len: 100, s: 1, name: 1 },
    { a: 0, b: 2, len: 600, s: 0, name: 2 },
    { a: 2, b: 3, len: 600, s: 0, name: 2 },
  ],
);

test('wetter ground floods at lower rainfall', () => {
  assert.ok(onsetRain(1) < onsetRain(0));
  assert.equal(riskAt(1, 0), 0);
  assert.equal(riskAt(1, 200), 1);
  assert.ok(riskAt(0.8, 40) > riskAt(0.2, 40));
});

test('with no rain both routes take the short road', () => {
  const { direct, safe } = planRoutes(graph, 0, 3, 0);
  assert.equal(direct.distance, 200);
  assert.equal(safe.distance, 200);
});

test('heavy rain moves the safe route to the dry road', () => {
  const { direct, safe } = planRoutes(graph, 0, 3, 40);
  assert.equal(direct.distance, 200);
  assert.equal(direct.floodedDistance, 200);
  assert.deepEqual(direct.floodedRoads, ['Low Road']);
  assert.equal(safe.distance, 1200);
  assert.equal(safe.floodedDistance, 0);
});

test('a report floods nearby roads even when it is dry', () => {
  const reported = edgesNearReports(graph, [{ lat: 12.97, lon: 80.2005 }]);
  assert.ok(reported.has(0));
  const { safe } = planRoutes(graph, 0, 3, 0, reported);
  assert.equal(safe.distance, 1200);
});

test('a cached direct path gives the same answer', () => {
  const cached = directPath(graph, 0, 3);
  assert.equal(planRoutes(graph, 0, 3, 40, new Set(), cached).direct.distance, 200);
});

test('route geometry keeps shape points and runs start to end', () => {
  assert.equal(edgeCoords(graph, 0).length, 3);
  const { direct } = planRoutes(graph, 3, 0, 0);
  assert.deepEqual(direct.coordinates[0], [80.202, 12.97]);
  assert.deepEqual(direct.coordinates.at(-1), [80.2, 12.97]);
});

test('one-way roads are only followed forwards', () => {
  const oneWay = pack(
    [
      [12.97, 80.2],
      [12.97, 80.201],
    ],
    [{ a: 0, b: 1, len: 100, oneway: true }],
  );
  assert.equal(planRoutes(oneWay, 0, 1, 0).direct.distance, 100);
  assert.equal(planRoutes(oneWay, 1, 0, 0).direct, null);
});

test('nearestNode finds the closest junction', () => {
  assert.equal(nearestNode(graph, 12.9749, 80.2001), 2);
});
