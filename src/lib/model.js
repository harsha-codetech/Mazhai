// Flood risk model and routing. No browser APIs, so it runs under `node --test` too.

// Rain intensity (mm per hour) at which the driest and wettest roads start to flood.
// These are demo assumptions, not calibrated values. Tune them with real flood records.
export const DRY_ROAD_ONSET = 100;
export const WET_ROAD_ONSET = 8;
export const RAMP = 20; // extra rain beyond a road's onset before it is fully flooded

export const AVOID_RISK = 0.6; // at or above this, a road counts as flooded
export const REPORT_RADIUS_M = 120;

const RISK_PENALTY = 6; // a road at full risk costs up to 7x its length
const FLOODED_PENALTY = 60; // flooded roads are a last resort, not forbidden

export function metres(aLat, aLon, bLat, bLon) {
  const x = (bLon - aLon) * 111320 * Math.cos((aLat * Math.PI) / 180);
  const y = (bLat - aLat) * 110574;
  return Math.hypot(x, y);
}

/** Rain intensity at which a road with this susceptibility (0 to 1) starts to flood. */
export function onsetRain(susceptibility) {
  return DRY_ROAD_ONSET - (DRY_ROAD_ONSET - WET_ROAD_ONSET) * susceptibility;
}

/** Flood risk from 0 to 1 for a road at the given rain intensity. */
export function riskAt(susceptibility, rain) {
  return Math.max(0, Math.min(1, (rain - onsetRain(susceptibility)) / RAMP));
}

/** Unpacks graph.bin (see scripts/build-data.mjs) and builds the routing index. */
export function buildGraph(buffer, meta) {
  const { nodeCount: n, edgeCount: m, shapeCount: s } = meta;
  let offset = 0;
  const take = (Type, count) => {
    const view = new Type(buffer, offset, count);
    offset += count * Type.BYTES_PER_ELEMENT;
    return view;
  };
  const graph = {
    nodeCount: n,
    edgeCount: m,
    names: meta.names,
    lat: take(Int32Array, n),
    lon: take(Int32Array, n),
    edgeA: take(Uint32Array, m),
    edgeB: take(Uint32Array, m),
    edgeLen: take(Float32Array, m),
    edgeName: take(Uint32Array, m),
    shapeStart: take(Uint32Array, m + 1),
    shapeLat: take(Int32Array, s),
    shapeLon: take(Int32Array, s),
    edgeSus: take(Uint8Array, m),
    edgeElev: take(Uint8Array, m),
    edgeFlags: take(Uint8Array, m),
  };

  // Compressed adjacency lists: the links leaving node i are firstLink[i]..firstLink[i + 1].
  const degree = new Uint32Array(n + 1);
  for (let e = 0; e < m; e++) {
    degree[graph.edgeA[e]]++;
    if (!(graph.edgeFlags[e] & 4)) degree[graph.edgeB[e]]++;
  }
  const firstLink = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) firstLink[i + 1] = firstLink[i] + degree[i];
  const cursor = firstLink.slice();
  const linkTo = new Uint32Array(firstLink[n]);
  const linkEdge = new Uint32Array(firstLink[n]);
  for (let e = 0; e < m; e++) {
    const a = graph.edgeA[e];
    const b = graph.edgeB[e];
    linkTo[cursor[a]] = b;
    linkEdge[cursor[a]++] = e;
    if (!(graph.edgeFlags[e] & 4)) {
      linkTo[cursor[b]] = a;
      linkEdge[cursor[b]++] = e;
    }
  }

  const edgeOnset = new Float32Array(m);
  for (let e = 0; e < m; e++) edgeOnset[e] = onsetRain(graph.edgeSus[e] / 255);
  return { ...graph, firstLink, linkTo, linkEdge, edgeOnset };
}

const toDegrees = (v) => v / 1e5;

/** Coordinates of an edge as [lon, lat] pairs, from node a to node b. */
export function edgeCoords(graph, e) {
  const points = [[toDegrees(graph.lon[graph.edgeA[e]]), toDegrees(graph.lat[graph.edgeA[e]])]];
  for (let i = graph.shapeStart[e]; i < graph.shapeStart[e + 1]; i++)
    points.push([toDegrees(graph.shapeLon[i]), toDegrees(graph.shapeLat[i])]);
  points.push([toDegrees(graph.lon[graph.edgeB[e]]), toDegrees(graph.lat[graph.edgeB[e]])]);
  return points;
}

export function nearestNode(graph, lat, lon) {
  let best = -1;
  let bestDistance = Infinity;
  const la = lat * 1e5;
  const lo = lon * 1e5;
  for (let i = 0; i < graph.nodeCount; i++) {
    const d = (graph.lat[i] - la) ** 2 + (graph.lon[i] - lo) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** Edges within REPORT_RADIUS_M of a report, as a Set of edge indexes. */
export function edgesNearReports(graph, reports) {
  const hit = new Set();
  for (const report of reports) {
    for (let e = 0; e < graph.edgeCount; e++) {
      const a = graph.edgeA[e];
      const b = graph.edgeB[e];
      const midLat = toDegrees(graph.lat[a] + graph.lat[b]) / 2;
      if (Math.abs(midLat - report.lat) > 0.01) continue;
      const midLon = toDegrees(graph.lon[a] + graph.lon[b]) / 2;
      if (metres(midLat, midLon, report.lat, report.lon) <= REPORT_RADIUS_M) hit.add(e);
    }
  }
  return hit;
}

function edgeRisk(graph, e, rain, reported) {
  if (reported.has(e)) return 1;
  return Math.max(0, Math.min(1, (rain - graph.edgeOnset[e]) / RAMP));
}

class MinHeap {
  keys = [];
  values = [];
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop() {
    const { keys, values } = this;
    const top = values[0];
    const key = keys.pop();
    const value = values.pop();
    const size = keys.length;
    if (size > 0) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= size) break;
        if (child + 1 < size && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
}

// A* search. Every edge costs at least its length, so straight-line distance is a safe estimate.
function shortestPath(graph, from, to, edgeCost) {
  const n = graph.nodeCount;
  const cost = new Float64Array(n).fill(Infinity);
  const viaEdge = new Int32Array(n).fill(-1);
  const viaNode = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  const goalLat = toDegrees(graph.lat[to]);
  const goalLon = toDegrees(graph.lon[to]);
  const estimate = (i) => 0.98 * metres(toDegrees(graph.lat[i]), toDegrees(graph.lon[i]), goalLat, goalLon);

  cost[from] = 0;
  heap.push(estimate(from), from);
  while (heap.size > 0) {
    const node = heap.pop();
    if (done[node]) continue;
    done[node] = 1;
    if (node === to) break;
    for (let l = graph.firstLink[node]; l < graph.firstLink[node + 1]; l++) {
      const next = graph.linkTo[l];
      const edge = graph.linkEdge[l];
      const total = cost[node] + edgeCost(edge);
      if (total < cost[next]) {
        cost[next] = total;
        viaEdge[next] = edge;
        viaNode[next] = node;
        heap.push(total + estimate(next), next);
      }
    }
  }
  if (cost[to] === Infinity) return null;

  const nodes = [to];
  const edges = [];
  for (let at = to; at !== from; at = viaNode[at]) {
    edges.push(viaEdge[at]);
    nodes.push(viaNode[at]);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}

function summarise(graph, path, rain, reported) {
  if (!path) return null;
  let distance = 0;
  let floodedDistance = 0;
  const floodedRoads = new Map();
  const coordinates = [];
  const wetLines = [];

  path.edges.forEach((e, i) => {
    let points = edgeCoords(graph, e);
    if (graph.edgeA[e] !== path.nodes[i]) points = points.reverse();
    coordinates.push(...(i === 0 ? points : points.slice(1)));
    distance += graph.edgeLen[e];
    if (edgeRisk(graph, e, rain, reported) >= AVOID_RISK) {
      floodedDistance += graph.edgeLen[e];
      wetLines.push(points);
      const name = graph.names[graph.edgeName[e]];
      if (name) floodedRoads.set(name, (floodedRoads.get(name) ?? 0) + graph.edgeLen[e]);
    }
  });
  return {
    distance,
    floodedDistance,
    floodedRoads: [...floodedRoads.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    coordinates,
    wetLines,
    edges: path.edges,
  };
}

/** The plain shortest path, which doesn't depend on rain, so it can be cached per trip. */
export function directPath(graph, from, to) {
  return shortestPath(graph, from, to, (e) => graph.edgeLen[e]);
}

/** Finds the usual route and the route that keeps out of the water. */
export function planRoutes(graph, from, to, rain, reported = new Set(), direct = directPath(graph, from, to)) {
  const safe = shortestPath(graph, from, to, (e) => {
    const risk = edgeRisk(graph, e, rain, reported);
    const penalty = risk >= AVOID_RISK ? FLOODED_PENALTY : RISK_PENALTY * risk;
    return graph.edgeLen[e] * (1 + penalty);
  });
  return { direct: summarise(graph, direct, rain, reported), safe: summarise(graph, safe, rain, reported) };
}
