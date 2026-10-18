// Terrain: map.png -> a typed array of terrain-type IDs, rendered from that array.
// The type array is the source of truth. setType() and explode() update pixels in
// place and grow a dirty rect, so render() re-uploads only what changed.
//
// clearCircle() is the pure grid math (no DOM), so it can be tested in node.

let width = 0;
let height = 0;
let types = null; // Uint8Array, one terrain-type ID per pixel (ID = index in balance.terrainKey)
let key = []; // [{ type, color, solid, resistance, rgb: [r, g, b] }]
let image = null; // ImageData built from the type array
let canvas = null; // offscreen canvas holding `image`
let canvasCtx = null;
let resistances = null; // Float32Array, resistance per type ID (0 = can't be cleared)
let openId = 0;
// Dirty rect in map pixels, inclusive. Empty when minX > maxX.
let dirtyMinX = 0;
let dirtyMinY = 0;
let dirtyMaxX = -1;
let dirtyMaxY = -1;

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

async function loadPixels(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const blob = await res.blob();
  // Ask the browser not to color-manage the PNG so we read the exact key colors.
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const off = document.createElement('canvas');
  off.width = bitmap.width;
  off.height = bitmap.height;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

export async function loadTerrain(url, balance) {
  key = balance.terrainKey.map((entry) => ({ ...entry, rgb: hexToRgb(entry.color) }));
  openId = Math.max(0, key.findIndex((k) => k.type === 'open'));
  // Only solid types can be cleared; open's resistance is irrelevant.
  resistances = Float32Array.from(key, (k) => (k.solid ? k.resistance : 0));

  const lookup = new Map();
  key.forEach((k, id) => lookup.set((k.rgb[0] << 16) | (k.rgb[1] << 8) | k.rgb[2], id));

  const src = await loadPixels(url);
  width = src.width;
  height = src.height;
  if (width !== balance.canvas.width || height !== balance.canvas.height) {
    console.warn(`map is ${width}x${height}, expected ${balance.canvas.width}x${balance.canvas.height}`);
  }

  types = new Uint8Array(width * height);
  const unknown = new Map(); // hex -> count
  const d = src.data;
  for (let i = 0, p = 0; i < types.length; i++, p += 4) {
    const rgb = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
    const id = lookup.get(rgb);
    if (id === undefined) {
      const hex = '#' + rgb.toString(16).padStart(6, '0');
      unknown.set(hex, (unknown.get(hex) || 0) + 1);
      types[i] = openId;
    } else {
      types[i] = id;
    }
  }
  if (unknown.size) {
    console.warn('map.png has colors not in the terrain key (treated as open):', Object.fromEntries(unknown));
  }

  canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvasCtx = canvas.getContext('2d');
  image = canvasCtx.createImageData(width, height);
  for (let i = 0; i < types.length; i++) writePixel(i);
  markDirty(0, 0, width - 1, height - 1);
}

function markDirty(x0, y0, x1, y1) {
  if (dirtyMinX > dirtyMaxX) {
    dirtyMinX = x0;
    dirtyMinY = y0;
    dirtyMaxX = x1;
    dirtyMaxY = y1;
    return;
  }
  dirtyMinX = Math.min(dirtyMinX, x0);
  dirtyMinY = Math.min(dirtyMinY, y0);
  dirtyMaxX = Math.max(dirtyMaxX, x1);
  dirtyMaxY = Math.max(dirtyMaxY, y1);
}

function writePixel(i) {
  const [r, g, b] = key[types[i]].rgb;
  const p = i * 4;
  image.data[p] = r;
  image.data[p + 1] = g;
  image.data[p + 2] = b;
  image.data[p + 3] = 255;
}

const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

/** Map size in pixels. */
export function getSize() {
  return { width, height };
}

/** Terrain-type ID at (x, y), or -1 outside the map. */
export function getType(x, y) {
  x |= 0;
  y |= 0;
  return inBounds(x, y) ? types[y * width + x] : -1;
}

/** Key entry ({ type, solid, resistance, ... }) for a type ID. */
export function getTypeInfo(id) {
  return key[id];
}

/** True if (x, y) is dirt or bedrock. Outside the map counts as not solid. */
export function isSolid(x, y) {
  const id = getType(x, y);
  return id >= 0 && key[id].solid;
}

/** Change one pixel's type in place; it is redrawn on the next render(). */
export function setType(x, y, id) {
  x |= 0;
  y |= 0;
  if (!inBounds(x, y)) return;
  const i = y * width + x;
  if (types[i] === id) return;
  types[i] = id;
  writePixel(i);
  markDirty(x, y, x, y);
}

/**
 * Pure grid math: clear solid pixels inside a circle, scaled by resistance.
 * A pixel is cleared only if its distance from (cx, cy) is < radius * resistance
 * of its type, so soft (1) clears to the full radius, harder dirt to less, and
 * resistance 0 (bedrock) never clears. With `ignoreResistance`, every pixel with
 * resistance > 0 inside the full radius clears (used for drone digging).
 * Only the circle's bounding box is visited, clipped to the grid.
 *
 * grid: { types: Uint8Array, width, height }
 * resistances: resistance per type ID; openId: the type written to cleared pixels.
 * onClear(i): optional, called with each cleared pixel's index.
 * Returns { cleared, minX, minY, maxX, maxY } (rect of cleared pixels, inclusive;
 * minX > maxX when nothing cleared).
 */
export function clearCircle(grid, resistances, openId, cx, cy, radius, { ignoreResistance = false, onClear } = {}) {
  const { types, width: w, height: h } = grid;
  const result = { cleared: 0, minX: w, minY: h, maxX: -1, maxY: -1 };
  if (!(radius > 0)) return result;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const res = resistances[types[i]];
      if (!(res > 0)) continue; // open, or unclearable (bedrock)
      const reach = ignoreResistance ? radius : radius * res;
      const dx = x - cx;
      if (dx * dx + dy * dy >= reach * reach) continue;
      types[i] = openId;
      result.cleared++;
      if (x < result.minX) result.minX = x;
      if (x > result.maxX) result.maxX = x;
      if (y < result.minY) result.minY = y;
      if (y > result.maxY) result.maxY = y;
      if (onClear) onClear(i);
    }
  }
  return result;
}

function clearAndRedraw(cx, cy, radius, options) {
  if (!types) return 0;
  const r = clearCircle({ types, width, height }, resistances, openId, cx, cy, radius, { ...options, onClear: writePixel });
  if (r.cleared) markDirty(r.minX, r.minY, r.maxX, r.maxY);
  return r.cleared;
}

/**
 * Blast at (cx, cy): clears dirt within radius * resistance (see clearCircle).
 * Used by the debug click harness now and by shots in slice 4.
 * Returns the number of pixels cleared.
 */
export function explode(cx, cy, radius) {
  return clearAndRedraw(cx, cy, radius);
}

/**
 * Drone digging (slice 7): clears every diggable pixel within the full radius,
 * since resistance slows the drone down instead of shrinking its tunnel (pair it
 * with resistanceAt() for speed). Bedrock still never clears.
 * Returns the number of pixels cleared.
 */
export function dig(cx, cy, radius) {
  return clearAndRedraw(cx, cy, radius, { ignoreResistance: true });
}

/** Resistance of the terrain at (x, y); 0 for open, bedrock, or outside the map. */
export function resistanceAt(x, y) {
  const id = getType(x, y);
  return id >= 0 ? resistances[id] : 0;
}

export function render(ctx) {
  if (dirtyMinX <= dirtyMaxX) {
    const dw = dirtyMaxX - dirtyMinX + 1;
    const dh = dirtyMaxY - dirtyMinY + 1;
    canvasCtx.putImageData(image, 0, 0, dirtyMinX, dirtyMinY, dw, dh);
    dirtyMaxX = -1; // empty the rect
    dirtyMinX = 0;
  }
  ctx.drawImage(canvas, 0, 0);
}
