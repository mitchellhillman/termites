// Entry point: load balance.json and the map, then run the draw loop.

import {
  loadTerrain, resetTerrain, render as renderTerrain, getSize, isSolid, explode, dig, resistanceAt, getType, getTypeInfo,
} from './terrain.js';
import { drawGrid, drawPowerBar, drawPlayerReadouts, drawTurnIndicator, drawAnnouncement, drawWinScreen } from './hud.js';
import { setupClickToExplode, setupKeyboard, playerControls } from './input.js';
import {
  createSoldier, findSurfaceSpawn, updateSoldier, drawSoldier, drawDeadUnit,
  spawnQueen, updateQueen, drawQueen, drawHealthDots, spawnDrones, updateDrone, drawDrone,
} from './units.js';
import {
  coinFlip, createPlayer, createTurnState, startTurn, turnStartSpawn, canAct, requestEndTurn, updateTurn, worldSettled,
  checkGameOver, canRestart, resetTurnState, resetPlayer,
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

  const world = { ...getSize(), isSolid, resistanceAt, dig };
  const restartKey = balance.winScreen.restartKey;
  const boundKeys = [...Object.values(balance.controls).flatMap((b) => Object.values(b)), restartKey];
  const keyboard = setupKeyboard(boundKeys);

  const cfg = balance.soldier;
  const shotCfg = balance.shot;
  const blastCfg = balance.explosion;
  const turnsCfg = balance.turns;
  const queenCfg = balance.queen;
  const droneCfg = balance.drone;
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
  // One queen per team (queens[i].team === i), on the floor of its chamber.
  const placeQueen = (team) => {
    const t = balance.teams[team];
    return spawnQueen(world, team, t.queenX, queenCfg, t.facing);
  };
  const queens = players.map((p) => placeQueen(p.team));
  // Both teams' drones in one list. Dead ones stay for droneCfg.corpseTime (the
  // placeholder death mark), then are removed.
  const drones = [];
  const droneCount = (team) => drones.reduce((n, d) => n + (d.team === team && !d.dead ? 1 : 0), 0);
  // n new drones at a team's queen's base (no cap here: turnStartSpawn applies it).
  const addDrones = (team, n) => {
    drones.push(...spawnDrones(queens[team], n, droneCfg));
  };
  const seedDrones = () => {
    drones.length = 0;
    for (const q of queens) addDrones(q.team, droneCfg.startCount);
  };
  seedDrones();
  const turn = createTurnState(coinFlip(), turnsCfg);
  // One shot in flight at most; input is locked while it flies and its explosion plays.
  const fx = { shot: null, explosion: null };

  const soldiers = () => players.map((p) => p.soldier);
  // Units whose falling holds up the turn handover (drones never do).
  const gravityUnits = () => [...soldiers(), ...queens];
  // Every unit a shot can hit or a blast can damage, both teams.
  const units = () => [...soldiers(), ...queens, ...drones];
  const center = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

  // Dirt color for explosion particles: whatever the shot hit, else soft dirt.
  const dirtColor = (x, y) => {
    const info = getTypeInfo(getType(x, y));
    if (info && info.solid) return info.color;
    return (balance.terrainKey.find((k) => k.type === 'soft') || balance.terrainKey[0]).color;
  };

  // A blast: clears dirt, then every living unit it touches (queens included,
  // friendly fire on) takes 1 hit. Win detection runs right after, in frame().
  function blast(x, y, radius) {
    const particleColor = dirtColor(x, y); // read before the blast clears it
    explode(x, y, radius);
    const hit = damageUnitsInRadius(units(), x, y, radius);
    fx.explosion = createExplosion(x, y, radius, particleColor, blastCfg);
    return hit;
  }

  function detonate(shot) {
    blast(shot.x, shot.y, blastRadius(impactAngle(shot.vx, shot.vy), blastCfg.minRadius, blastCfg.maxRadius));
  }

  // Restart key on the win screen: same map with every crater and tunnel undone,
  // fresh queens, soldiers and starting drones, cleared players and a new coin
  // flip. Everything is reset in place so window.termites keeps pointing at live
  // state.
  function restart() {
    resetTerrain();
    fx.shot = null;
    fx.explosion = null;
    queens.forEach((q, i) => (queens[i] = placeQueen(q.team)));
    for (const p of players) {
      resetPlayer(p, shotCfg);
      p.soldier = spawnSoldier(p.team);
    }
    seedDrones();
    resetTurnState(turn, coinFlip(), turnsCfg);
  }

  // Debug handle for the console and browser tests.
  window.termites = { players, queens, drones, turn, fx, blast, restart, addDrones, droneCount };

  // Start of a turn: the queen spawns drones, or a new soldier if hers is dead
  // (the rule is in turns.js turnStartSpawn), then AP comes from the drone count.
  function beginTurn(player) {
    const spawn = turnStartSpawn(player, droneCount(player.team), droneCfg);
    if (spawn.soldier) player.soldier = spawnSoldier(player.team);
    addDrones(player.team, spawn.drones);
    startTurn(player, turnsCfg, droneCount(player.team));
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
    if (canRestart(turn) && keyboard.wasPressed(restartKey)) restart();
    if (canAct(turn, turn.active) && active.controls.pressed('endTurn')) requestEndTurn(turn, active);
    const locked = fx.shot || fx.explosion || active.soldier.dead;
    players.forEach((p, i) => {
      const walkDir = canAct(turn, i) && !locked ? handleControls(p, dt) : 0;
      if (!p.soldier.dead) updateSoldier(world, p.soldier, dt, cfg, walkDir, p.walkBudget, p);
    });
    for (const q of queens) updateQueen(world, q, dt, queenCfg);
    // Drones run in real time in every phase: both turns, the coin flip and the win screen.
    for (const d of drones) updateDrone(world, d, dt, droneCfg);
    keyboard.endFrame();

    if (fx.shot) {
      const result = stepShot(fx.shot, dt, world, units(), shotCfg);
      if (result === 'impact') detonate(fx.shot);
      if (result !== 'flying') fx.shot = null;
    }
    // Win check right after any blast resolves (and every frame, so it also catches
    // debug-handle blasts). The 'over' phase locks input at once; the win screen
    // itself waits for the explosion to finish and the world to settle.
    checkGameOver(turn, players, queens);
    if (fx.explosion && !updateExplosion(fx.explosion, dt, blastCfg)) fx.explosion = null;
    for (let i = drones.length - 1; i >= 0; i--) {
      const d = drones[i];
      if (d.dead && (d.deadTime += dt) >= droneCfg.corpseTime) drones.splice(i, 1);
    }

    if (updateTurn(turn, dt, players, worldSettled(world, fx, gravityUnits()), turnsCfg)) beginTurn(players[turn.active]);

    ctx.fillStyle = balance.canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderTerrain(ctx);
    drawGrid(ctx, balance);
    for (const q of queens) {
      const color = teamColor(q.team);
      if (q.dead) drawDeadUnit(ctx, q, color);
      else drawQueen(ctx, q, color, queenCfg.eyeColor);
      drawHealthDots(ctx, q, color, queenCfg.dots);
    }
    for (const d of drones) {
      if (d.dead) drawDeadUnit(ctx, d, teamColor(d.team));
      else drawDrone(ctx, d, teamColor(d.team), droneCfg);
    }
    players.forEach((p, i) => {
      const s = p.soldier;
      const color = teamColor(p.team);
      if (s.dead) return drawDeadUnit(ctx, s, color);
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
    drawPlayerReadouts(ctx, balance, players, turn, players.map((p) => droneCount(p.team)));
    drawAnnouncement(ctx, balance, players, turn);
    drawWinScreen(ctx, balance, players, turn);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err.message}`;
  document.body.style.color = '#fff';
});
