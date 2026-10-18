// Entry point: load balance.json and the map, then run the draw loop.

import { loadTerrain, render as renderTerrain, getSize, isSolid, explode, getType, getTypeInfo } from './terrain.js';
import { drawGrid, drawPowerBar, drawPlayerReadouts, drawTurnIndicator, drawAnnouncement } from './hud.js';
import { setupClickToExplode, setupKeyboard, playerControls } from './input.js';
import { createSoldier, findSurfaceSpawn, updateSoldier, drawSoldier, drawDeadSoldier } from './units.js';
import {
  coinFlip, createPlayer, createTurnState, startTurn, canAct, requestEndTurn, updateTurn, worldSettled,
} from './turns.js';
import {
  moveAim, aimPoint, updateCharge, pressFire, cancelCharge, currentPower, launchSpeed,
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
  const keyboard = setupKeyboard(boundKeys);

  const cfg = balance.soldier;
  const shotCfg = balance.shot;
  const blastCfg = balance.explosion;
  const turnsCfg = balance.turns;
  const teamColor = (team) => balance.teams[team].color;
  // A new soldier on the surface above its side's chamber, facing the middle.
  const spawnSoldier = (team) => {
    const t = balance.teams[team];
    const spawn = findSurfaceSpawn(world, t.spawnX, cfg.width, cfg.height);
    return createSoldier(team, spawn.x, spawn.y, cfg, t.facing);
  };
  const bindings = [balance.controls.p1, balance.controls.p2];
  const players = bindings.map((b, team) => {
    const p = createPlayer(team, playerControls(keyboard, b), cfg, shotCfg);
    p.soldier = spawnSoldier(team);
    return p;
  });
  const turn = createTurnState(coinFlip(), turnsCfg);
  // One shot in flight at most; input is locked while it flies and its explosion plays.
  const fx = { shot: null, explosion: null };
  window.termites = { players, turn, fx }; // debug handle for the console and browser tests

  const soldiers = () => players.map((p) => p.soldier);
  const units = soldiers; // every unit a shot can hit, both teams (queens and drones in slices 6-7)
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
    damageUnitsInRadius(units(), shot.x, shot.y, radius); // friendly fire included
    fx.explosion = createExplosion(shot.x, shot.y, radius, particleColor, blastCfg);
  }

  // Debug stand-in for slice 7's respawn rules: a dead soldier comes back at its
  // spawn point, keeping its facing.
  function respawn(player) {
    const old = player.soldier;
    player.soldier = spawnSoldier(player.team);
    player.soldier.facing = old.facing;
    player.respawnTimer = 0;
  }

  // Start of a turn. Slice 7 replaces the dead-soldier respawn here with the queen
  // rules; turns.js startTurn() is where drones will set the AP.
  function beginTurn(player) {
    if (player.soldier.dead) respawn(player);
    startTurn(player, turnsCfg);
  }

  // The active player's keys. Returns their walk direction (-1, 0, 1).
  function handleControls(player, dt) {
    const { controls, soldier, aim } = player;
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

    // Input: only the active player's keys count. End Turn is accepted even while
    // a shot flies; the handover still waits for things to settle.
    const active = players[turn.active];
    if (canAct(turn, turn.active) && active.controls.pressed('endTurn')) requestEndTurn(turn, active);
    const locked = fx.shot || fx.explosion || active.soldier.dead;
    players.forEach((p, i) => {
      const walkDir = canAct(turn, i) && !locked ? handleControls(p, dt) : 0;
      if (!p.soldier.dead) updateSoldier(world, p.soldier, dt, cfg, walkDir, p.walkBudget, p);
    });
    keyboard.endFrame();

    if (fx.shot) {
      const result = stepShot(fx.shot, dt, world, units(), shotCfg);
      if (result === 'impact') detonate(fx.shot);
      if (result !== 'flying') fx.shot = null;
    }
    if (fx.explosion && !updateExplosion(fx.explosion, dt, blastCfg)) fx.explosion = null;
    for (const p of players) {
      if (!p.soldier.dead || fx.explosion) continue;
      p.respawnTimer += dt;
      if (p.respawnTimer >= balance.debug.respawnDelay) respawn(p);
    }

    if (updateTurn(turn, dt, players, worldSettled(world, fx, soldiers()), turnsCfg)) beginTurn(players[turn.active]);

    ctx.fillStyle = balance.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderTerrain(ctx);
    drawGrid(ctx, balance);
    players.forEach((p, i) => {
      const s = p.soldier;
      const color = teamColor(p.team);
      if (s.dead) return drawDeadSoldier(ctx, s, color);
      drawSoldier(ctx, s, color, cfg.eyeColor);
      if (canAct(turn, i) && p.aim.mode === 'shoot' && !fx.shot) {
        const c = center(s);
        const pt = aimPoint(c.x, c.y, p.aim.angle, s.facing, shotCfg.aimArcRadius);
        drawAimCursor(ctx, pt.x, pt.y, color);
        if (p.aim.charging) drawPowerBar(ctx, balance, s, currentPower(p.aim));
      }
    });
    if (fx.shot) drawShot(ctx, fx.shot, teamColor(fx.shot.owner.team), shotCfg.size);
    if (fx.explosion) drawExplosion(ctx, fx.explosion, blastCfg);
    if (debugExplode) debugExplode.draw(ctx);
    drawTurnIndicator(ctx, balance, players, turn);
    drawPlayerReadouts(ctx, balance, players, turn);
    drawAnnouncement(ctx, balance, players, turn);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err.message}`;
  document.body.style.color = '#fff';
});
