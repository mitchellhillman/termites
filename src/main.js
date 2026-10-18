// Entry point: load balance.json and the map, then run the draw loop.

import { loadTerrain, render as renderTerrain, getSize, isSolid } from './terrain.js';
import { drawGrid, drawWalkReadout } from './hud.js';
import { setupClickToExplode, setupKeyboard, playerControls } from './input.js';
import { createSoldier, findSurfaceSpawn, updateSoldier, drawSoldier, WalkBudget } from './units.js';

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

  const world = { ...getSize(), isSolid };
  const boundKeys = Object.values(balance.controls).flatMap((b) => Object.values(b));
  const keyboard = setupKeyboard([...boundKeys, balance.debug.refillAPKey]);

  // Slice 3: Player 1 only, with a temporary AP pool until turns exist (slice 5).
  const cfg = balance.soldier;
  const team = 0;
  const spawn = findSurfaceSpawn(world, balance.teams[team].spawnX, cfg.width, cfg.height);
  const player = {
    team,
    ap: balance.debug.soldierStartAP,
    walkBudget: new WalkBudget(cfg.walkPxPerAP, cfg.walkAPCost),
    controls: playerControls(keyboard, balance.controls.p1),
    soldier: createSoldier(team, spawn.x, spawn.y, cfg, 1),
  };
  window.termites = { player }; // debug handle for the console and browser tests

  let last = null;
  function frame(now) {
    const dt = last === null ? 0 : Math.min(balance.timing.maxFrameDt, (now - last) / 1000);
    last = now;

    const { controls, soldier } = player;
    if (controls.pressed('faceUp') || controls.pressed('faceDown')) soldier.facing = -soldier.facing;
    if (keyboard.wasPressed(balance.debug.refillAPKey)) player.ap = balance.debug.soldierStartAP;
    updateSoldier(world, soldier, dt, cfg, controls.walkDir(), player.walkBudget, player);
    keyboard.endFrame();

    ctx.fillStyle = balance.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderTerrain(ctx);
    drawGrid(ctx, balance);
    drawSoldier(ctx, soldier, balance.teams[team].color, cfg.eyeColor);
    if (debugExplode) debugExplode.draw(ctx);
    drawWalkReadout(ctx, balance, player);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err.message}`;
  document.body.style.color = '#fff';
});
