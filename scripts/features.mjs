// The 100 m ground-height grid used by the data build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';

export const BBOX = { s: 12.78, w: 80.0, n: 13.25, e: 80.35 };
export const STEP = 0.0009; // about 100 m
export const rows = Math.round((BBOX.n - BBOX.s) / STEP) + 1;
export const cols = Math.round((BBOX.e - BBOX.w) / STEP) + 1;
export const RAW = new URL('./raw/chennai/', import.meta.url);

export const toRow = (lat) => Math.round((lat - BBOX.s) / STEP);
export const toCol = (lon) => Math.round((lon - BBOX.w) / STEP);

export function cellAt(grid, lat, lon) {
  const r = Math.max(0, Math.min(rows - 1, toRow(lat)));
  const c = Math.max(0, Math.min(cols - 1, toCol(lon)));
  return grid[r * cols + c];
}

/** Ground-only elevation from FABDEM, averaged from 30 m pixels onto the 100 m grid. */
export async function elevationGrid(tileFiles) {
  const tiles = [];
  for (const name of tileFiles) {
    const tiff = await fromFile(fileURLToPath(new URL(name, RAW)));
    const image = await tiff.getImage();
    const [west, south, east, north] = image.getBoundingBox();
    const [data] = await image.readRasters();
    tiles.push({ west, south, east, north, width: image.getWidth(), height: image.getHeight(), data });
  }
  const grid = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const lat = BBOX.s + r * STEP;
    for (let c = 0; c < cols; c++) {
      const lon = BBOX.w + c * STEP;
      let sum = 0;
      let count = 0;
      for (const dy of [-0.0003, 0, 0.0003])
        for (const dx of [-0.0003, 0, 0.0003]) {
          const y0 = lat + dy;
          const tile = tiles.find((t) => y0 >= t.south && y0 < t.north);
          if (!tile) continue;
          const x = Math.floor(((lon + dx - tile.west) / (tile.east - tile.west)) * tile.width);
          const y = Math.floor(((tile.north - y0) / (tile.north - tile.south)) * tile.height);
          const v = tile.data[y * tile.width + x];
          if (v > -1000 && v < 10000) {
            sum += v;
            count++;
          }
        }
      grid[r * cols + c] = count ? sum / count : 0; // no data here means open sea
    }
  }
  return grid;
}

export function boxBlur(grid, radius) {
  const pass = (source, stepAlong, count, stepAcross, lines) => {
    const out = new Float32Array(source.length);
    for (let l = 0; l < lines; l++)
      for (let i = 0; i < count; i++) {
        let sum = 0;
        let n = 0;
        for (let k = Math.max(0, i - radius); k <= Math.min(count - 1, i + radius); k++) {
          sum += source[l * stepAcross + k * stepAlong];
          n++;
        }
        out[l * stepAcross + i * stepAlong] = sum / n;
      }
    return out;
  };
  return pass(pass(grid, 1, cols, cols, rows), cols, rows, 1, cols);
}

export const readRaw = (name) => JSON.parse(readFileSync(new URL(name, RAW)));
