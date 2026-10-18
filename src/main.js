// Entry point: load balance.json and the map, then run the draw loop.

import { loadTerrain, render as renderTerrain, getSize, isSolid, explode, getType, getTypeInfo } from './terrain.js';
import { drawGrid, drawWalkReadout, drawPowerBar } from './hud.js';
import { setupClickToExplode, setupKeyboard, playerControls } from './input.js';
import { createSoldier, findSurfaceSpawn, updateSoldier, drawSoldier, drawDeadSoldier, WalkBudget } from './units.js';
import {
  createAim, moveAim, aimPoint, updateCharge, pressFire, cancelCharge, currentPower, launchSpeed,
  createShot, stepShot, impactAngle, blastRadius, damageUnitsInRadius,
  createExplosion, updateExplosion, drawExplosion, drawAimCursor, drawShot,
} from './shots.js';

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

  // Slices 3-4: Player 1 only, with a temporary AP pool until turns exist (slice 5).
  const cfg = balance.soldier;
  const shotCfg = balance.shot;
  const blastCfg = balance.explosion;
  const team = 0;
  const color = balance.teams[team].color;
  const spawnSoldier = () => {
    const spawn = findSurfaceSpawn(world, balance.teams[team].spawnX, cfg.width, cfg.height);
    return createSoldier(team, spawn.x, spawn.y, cfg, 1);
  };
  const player = {
    team,
    ap: balance.debug.soldierStartAP,
    walkBudget: new WalkBudget(cfg.walkPxPerAP, cfg.walkAPCost),
    controls: playerControls(keyboard, balance.controls.p1),
    soldier: spawnSoldier(),
    aim: createAim(shotCfg),
  };
  // One shot in flight at most; input is locked while it flies and its explosion plays.
  const fx = { shot: null, explosion: null, respawnTimer: 0 };
  window.termites = { player, fx }; // debug handle for the console and browser tests

  const units = () => [player.soldier]; // every unit a shot can hit (more in slices 5-7)
  const center = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

  // Dirt color for explosion particles: whatever the shot hit, else soft dirt.
  const dirtColor = (x, y) => {
    const info = getTypeInfo(getType(x, y));
    if (info && info.solid) return info.color;
    return (balance.terrainKey.find((k) => k.type === 'soft') || balance.terrainKey[0]).color;
  };

  function detonate(shot) {
    const radius = blastRadius(impactAngle(shot.vx, shot.vy), blastCfg.minRadius, blastCfg.maxRadius);
    const particleColor = dirtColor(shot.x, shot.y); // read before the blast clears it
    explode(shot.x, shot.y, radius);
    damageUnitsInRadius(units(), shot.x, shot.y, radius);
    fx.explosion = createExplosion(shot.x, shot.y, radius, particleColor, blastCfg);
  }

  function handleControls(dt) {
    const { controls, soldier, aim } = player;
    if (keyboard.wasPressed(balance.debug.refillAPKey)) player.ap = balance.debug.soldierStartAP;
    if (controls.pressed('mode')) {
      aim.mode = aim.mode === 'walk' ? 'shoot' : 'walk';
      player.walkBudget.forfeit(); // leftover walk travel is lost on any mode switch
      cancelCharge(aim);
    }
    // Aim and facing freeze while the PWR bar sweeps, so the second press is pure timing.
    if (!aim.charging && (controls.pressed('faceUp') || controls.pressed('faceDown'))) soldier.facing = -soldier.facing;
    if (aim.mode === 'walk') return controls.walkDir();

    if (!aim.charging) moveAim(aim, controls.walkDir(), soldier.facing, dt, shotCfg);
    updateCharge(aim, dt, shotCfg);
    if (controls.pressed('fire')) {
      const fired = pressFire(aim, player, shotCfg);
      if (fired) {
        const c = center(soldier);
        fx.shot = createShot(c.x, c.y, aim.angle, soldier.facing, launchSpeed(fired.power, shotCfg), soldier);
      }
    }
    return 0; // no walking in shoot mode
  }

  let last = null;
  function frame(now) {
    const dt = last === null ? 0 : Math.min(balance.timing.maxFrameDt, (now - last) / 1000);
    last = now;

    const soldier = player.soldier;
    const locked = fx.shot || fx.explosion || soldier.dead;
    const walkDir = locked ? 0 : handleControls(dt);
    if (!soldier.dead) updateSoldier(world, soldier, dt, cfg, walkDir, player.walkBudget, player);
    keyboard.endFrame();

    if (fx.shot) {
      const result = stepShot(fx.shot, dt, world, units(), shotCfg);
      if (result === 'impact') detonate(fx.shot);
      if (result !== 'flying') fx.shot = null;
    }
    if (fx.explosion && !updateExplosion(fx.explosion, dt, blastCfg)) fx.explosion = null;
    // Debug stand-in for slice 7's next-turn respawn: back at the spawn after a delay.
    if (soldier.dead && !fx.explosion) {
      fx.respawnTimer += dt;
      if (fx.respawnTimer >= balance.debug.respawnDelay) {
        fx.respawnTimer = 0;
        player.soldier = spawnSoldier();
        player.soldier.facing = soldier.facing;
      }
    }

    ctx.fillStyle = balance.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderTerrain(ctx);
    drawGrid(ctx, balance);
    const s = player.soldier;
    if (s.dead) drawDeadSoldier(ctx, s, color);
    else {
      drawSoldier(ctx, s, color, cfg.eyeColor);
      if (player.aim.mode === 'shoot' && !fx.shot) {
        const c = center(s);
        const p = aimPoint(c.x, c.y, player.aim.angle, s.facing, shotCfg.aimArcRadius);
        drawAimCursor(ctx, p.x, p.y, color);
        if (player.aim.charging) drawPowerBar(ctx, balance, s, currentPower(player.aim));
      }
    }
    if (fx.shot) drawShot(ctx, fx.shot, color, shotCfg.size);
    if (fx.explosion) drawExplosion(ctx, fx.explosion, blastCfg);
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
