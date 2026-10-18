// Terrain: map.png -> a typed array of terrain-type IDs, rendered from that array.
// The type array is the source of truth. setType() updates one pixel in place and
// marks the image dirty, so slice 2 can clear dirt cheaply.

let width = 0;
let height = 0;
let types = null; // Uint8Array, one terrain-type ID per pixel (ID = index in balance.terrainKey)
let key = []; // [{ type, color, solid, resistance, rgb: [r, g, b] }]
let image = null; // ImageData built from the type array
let canvas = null; // offscreen canvas holding `image`
let canvasCtx = null;
let dirty = true;

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
  const openId = Math.max(0, key.findIndex((k) => k.type === 'open'));

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
  dirty = true;
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
  dirty = true;
}

export function render(ctx) {
  if (dirty) {
    canvasCtx.putImageData(image, 0, 0);
    dirty = false;
  }
  ctx.drawImage(canvas, 0, 0);
}
