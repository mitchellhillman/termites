// One-off map generator. Run from the repo root:  node tools/generate-map.mjs
// Reads colors and parameters from balance.json and writes map.png (no dependencies).
// Uses a fixed seed, so re-running produces the same map.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodePNG } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const balance = JSON.parse(readFileSync(join(root, 'balance.json'), 'utf8'));
const { width: W, height: H } = balance.canvas;
const g = balance.mapGenerator;

// --- colors from the key -----------------------------------------------------
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const color = {};
for (const entry of balance.terrainKey) color[entry.type] = hexToRgb(entry.color);

// --- seeded RNG (mulberry32) -------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(g.seed);

// A smooth wavy curve: sum of a few sines with random phases and frequencies.
function makeWave(amplitude, waves, minCycles, maxCycles) {
  const parts = [];
  for (let i = 0; i < waves; i++) {
    parts.push({
      cycles: minCycles + rand() * (maxCycles - minCycles),
      phase: rand() * Math.PI * 2,
      amp: amplitude / (i + 1),
    });
  }
  const norm = parts.reduce((s, p) => s + p.amp, 0);
  return (x) => {
    let y = 0;
    for (const p of parts) y += p.amp * Math.sin((x / W) * p.cycles * Math.PI * 2 + p.phase);
    return (y / norm) * amplitude;
  };
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const hillWave = makeWave(g.hillAmplitude, g.hillWaves, 1.5, 4);
const band1Wave = makeWave(g.bandWaveAmplitude, 3, 1, 5);
const band2Wave = makeWave(g.bandWaveAmplitude, 3, 1, 5);

// Hills fade out toward each edge so the ground there is flatter.
function surfaceAt(x) {
  const edge = Math.min(x, W - 1 - x);
  const blend = smoothstep(0, g.flatEdgeWidth, edge);
  return Math.round(g.surfaceY + hillWave(x) * blend);
}

// Chambers: flat floor, rounded top, near each left/right edge.
const chambers = [
  { x0: g.chamberEdgeMargin },
  { x0: W - g.chamberEdgeMargin - g.chamberWidth },
].map((c) => ({ ...c, x1: c.x0 + g.chamberWidth, y1: g.chamberFloorY, y0: g.chamberFloorY - g.chamberHeight }));

function inChamber(x, y) {
  for (const c of chambers) {
    if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1) continue;
    // Round the top corners with a half-ellipse cap of the chamber's width.
    const rx = g.chamberWidth / 2;
    const ry = Math.min(rx, g.chamberHeight / 2);
    const capBottom = c.y0 + ry;
    if (y >= capBottom) return true;
    const dx = (x + 0.5 - (c.x0 + rx)) / rx;
    const dy = (y + 0.5 - capBottom) / ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

// --- paint -------------------------------------------------------------------
const pixels = Buffer.alloc(W * H * 3);
const bedrockTop = H - g.bedrockHeight;
for (let x = 0; x < W; x++) {
  const surface = surfaceAt(x);
  const b1 = Math.round(g.softMediumY + band1Wave(x));
  const b2 = Math.round(g.mediumHardY + band2Wave(x));
  for (let y = 0; y < H; y++) {
    let type;
    if (y >= bedrockTop) type = 'bedrock';
    else if (y < surface) type = 'open';
    else if (inChamber(x, y)) type = 'open';
    else if (y < b1) type = 'soft';
    else if (y < b2) type = 'medium';
    else type = 'hard';
    const [r, gg, b] = color[type];
    const i = (y * W + x) * 3;
    pixels[i] = r;
    pixels[i + 1] = gg;
    pixels[i + 2] = b;
  }
}

// --- write -----------------------------------------------------------------
const png = encodePNG(W, H, pixels, 3);

const outPath = join(root, balance.mapFile);
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${W}x${H}, ${png.length} bytes)`);
