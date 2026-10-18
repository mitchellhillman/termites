// Entry point: load balance.json and the map, then run the draw loop.

import { loadTerrain, render as renderTerrain } from './terrain.js';
import { drawGrid } from './hud.js';
import { setupClickToExplode } from './input.js';

async function loadBalance() {
  const res = await fetch('balance.json');
  if (!res.ok) throw new Error(`Failed to load balance.json: ${res.status}`);
  return res.json();
}

// Scale the canvas by a whole number so pixels stay crisp.
function fitToWindow(canvas, balance) {
  const { width, height } = balance.canvas;
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / width, window.innerHeight / height)));
  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;
}

async function start() {
  const balance = await loadBalance();
  const canvas = document.getElementById('game');
  canvas.width = balance.canvas.width;
  canvas.height = balance.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  fitToWindow(canvas, balance);
  window.addEventListener('resize', () => fitToWindow(canvas, balance));

  await loadTerrain(balance.mapFile, balance);
  const debugExplode = setupClickToExplode(canvas, balance);

  function frame() {
    ctx.fillStyle = balance.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderTerrain(ctx);
    drawGrid(ctx, balance);
    if (debugExplode) debugExplode.draw(ctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err.message}`;
  document.body.style.color = '#fff';
});
