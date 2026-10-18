// Turns (slice 5): two players, the coin flip, per-turn AP, and when a turn ends.
// Slice 6: win rules, the game-over phase and restart.
// Slice 7: the queen's start-of-turn spawn (drones, or a new soldier) and AP from
// the drone count.
//
// Pure state with no DOM, so node can test it. main.js owns the loop: it calls
// updateTurn() every frame and startTurn() whenever updateTurn() says a new turn
// begins.
//
// Phases:
//   'announce' - the coin flip result is on screen; nobody can act.
//   'play'     - the active player acts.
//   'ending'   - the turn is over (End Turn key, 0 AP with no walk left, or the
//                active soldier died). Input is locked; the turn hands over once
//                the world has stayed settled (no shot, no explosion, no soldier
//                falling) for cfg.settleDelay seconds. Drones never hold it
//                up: they are always moving (see worldSettled).
//   'over'     - a queen died (see gameResult). Nobody can act and the turn never
//                hands over. turn.result says who won. The win screen waits until
//                the world has stayed settled (explosion finished, every unit
//                landed) for cfg.gameOverDelay, then turn.resultShown goes true and
//                the restart key works. Entered from any phase the moment a blast
//                leaves a queen dead (checkGameOver, called every frame).
//
// The last-AP walk: spending the last AP on walking leaves AP at 0 but unlocks
// 40px of travel. The 0-AP auto-end waits until that travel is used up or
// forfeited (mode switch or End Turn), so the last walk is never cut off. A player
// who stops partway keeps the turn until they press End Turn or switch modes.
//
// Mode: every turn starts in walk mode (aim angle and facing are kept).

import { WalkBudget, isSupported } from './units.js';
import { createAim, cancelCharge } from './shots.js';

/**
 * Who won, from the queens (one per team, `team` = player index):
 *   null                    - every queen is alive, play on
 *   { winner: i, draw: false } - only team i's queen survives
 *   { winner: null, draw: true } - no queen survives (both died in the same blast)
 * Whoever fired the shot doesn't matter: killing your own queen hands the win to
 * the other side.
 */
export function gameResult(queens) {
  const alive = queens.filter((q) => !q.dead);
  if (alive.length === queens.length) return null;
  if (alive.length === 0) return { winner: null, draw: true };
  return { winner: alive[0].team, draw: false };
}

/**
 * Enter the 'over' phase if a queen has died. Returns true on the frame the game
 * ends. Any half-charged PWR bar or leftover walk is dropped so nothing moves.
 */
export function checkGameOver(turn, players, queens) {
  if (turn.phase === 'over') return false;
  const result = gameResult(queens);
  if (!result) return false;
  turn.phase = 'over';
  turn.result = result;
  turn.resultShown = false;
  turn.settleTimer = 0;
  turn.endRequested = false;
  for (const p of players) {
    p.walkBudget.forfeit();
    cancelCharge(p.aim);
  }
  return true;
}

/** True once the win screen is up and the restart key may be used. */
export function canRestart(turn) {
  return turn.phase === 'over' && turn.resultShown;
}

/** Restart: a fresh turn state (new coin flip result `first`), mutated in place. */
export function resetTurnState(turn, first, cfg) {
  for (const k of Object.keys(turn)) delete turn[k];
  return Object.assign(turn, createTurnState(first, cfg));
}

/** Restart: back to a new player's state (no AP, no walk, fresh aim). The caller respawns the soldier. */
export function resetPlayer(player, shotCfg) {
  player.ap = 0;
  player.walkBudget.forfeit();
  player.aim = createAim(shotCfg);
}

/** Index of the player who goes first: 0 or 1. rand: () => 0..1. */
export function coinFlip(rand = Math.random) {
  return rand() < 0.5 ? 0 : 1;
}

/** Per-player state. `controls` comes from input.js playerControls (or a test stub). */
export function createPlayer(team, controls, soldierCfg, shotCfg) {
  return {
    team,
    ap: 0,
    walkBudget: new WalkBudget(soldierCfg.walkPxPerAP, soldierCfg.walkAPCost),
    controls,
    soldier: null,
    aim: createAim(shotCfg),
  };
}

export function createTurnState(first, cfg) {
  return {
    active: first,
    first,
    phase: 'announce',
    timer: cfg.announceDuration,
    settleTimer: 0,
    endRequested: false,
    number: 0,
    result: null, // set by checkGameOver: { winner, draw }
    resultShown: false,
  };
}

/** AP granted at the start of a turn: floor(living drones / cfg.dronesPerAP). */
export function turnAP(droneCount, cfg) {
  return Math.floor(droneCount / cfg.dronesPerAP);
}

/**
 * What the queen spawns at the start of her side's turn, before the AP is set.
 * This is the one place the soldier-death rule lives:
 *   - soldier dead: she spawns a new soldier (on the surface above her) INSTEAD
 *     of drones this turn. It doesn't matter whose turn the soldier died in.
 *   - otherwise: droneCfg.spawnPerTurn drones, capped so the side's living
 *     drones never exceed droneCfg.cap.
 * So the turn after a soldier dies has no drone spawn, and normal spawning
 * resumes the turn after that. Returns { soldier: bool, drones: n }.
 */
export function turnStartSpawn(player, liveDrones, droneCfg) {
  if (!player.soldier || player.soldier.dead) return { soldier: true, drones: 0 };
  return { soldier: false, drones: Math.max(0, Math.min(droneCfg.spawnPerTurn, droneCfg.cap - liveDrones)) };
}

/**
 * Start-of-turn step for `player`, after the queen's spawn (turnStartSpawn):
 * AP from the side's living drones. Unused AP never carries over: AP is set, not
 * added.
 */
export function startTurn(player, cfg, droneCount) {
  player.ap = turnAP(droneCount, cfg);
  player.walkBudget.forfeit();
  player.aim.mode = 'walk';
  cancelCharge(player.aim);
}

/**
 * True if player `index` may act: only the active player, only while their turn is
 * in play and End Turn hasn't been pressed. Everyone else's keys are ignored.
 */
export function canAct(turn, index) {
  return turn.phase === 'play' && turn.active === index && !turn.endRequested;
}

/** End Turn key: ends the turn early (it hands over once things settle). */
export function requestEndTurn(turn, player) {
  if (turn.phase !== 'play') return;
  turn.endRequested = true;
  player.walkBudget.forfeit();
  cancelCharge(player.aim);
}

/** True if the active player's turn is over (it may still be waiting to settle). */
export function turnOver(turn, player) {
  if (turn.endRequested) return true;
  if (!player.soldier || player.soldier.dead) return true;
  // At 0 AP, wait for any leftover walk travel (the last-AP walk) to be used.
  return player.ap <= 0 && player.walkBudget.remaining <= 0 && !player.aim.charging;
}

/**
 * No shot flying, no explosion playing, and no living soldier or queen falling
 * (a falling queen blocks the handover just like a falling soldier). Drones are
 * skipped even if passed in: they wander forever, so waiting on them would stall
 * the handover.
 */
export function worldSettled(world, fx, units) {
  if (fx.shot || fx.explosion) return false;
  return units.every((u) => !u || u.dead || u.kind === 'drone' || isSupported(world, u));
}

/**
 * Advance the turn state by dt. `players` is the array of both players, `settled`
 * the result of worldSettled() this frame. Returns true when a new turn begins
 * (turn.active is already the new player); the caller then runs startTurn().
 */
export function updateTurn(turn, dt, players, settled, cfg) {
  if (turn.phase === 'over') {
    // Win screen once the dust settles; the game never hands over again.
    turn.settleTimer = settled ? turn.settleTimer + dt : 0;
    if (turn.settleTimer >= cfg.gameOverDelay) turn.resultShown = true;
    return false;
  }
  if (turn.phase === 'announce') {
    turn.timer -= dt;
    if (turn.timer > 0) return false;
    turn.phase = 'play';
    turn.number = 1;
    return true;
  }
  const player = players[turn.active];
  if (turn.phase === 'play') {
    if (!turnOver(turn, player)) return false;
    turn.phase = 'ending';
    turn.settleTimer = 0;
    player.ap = 0; // unused AP is lost (it never carries over)
    player.walkBudget.forfeit(); // and so is leftover walk travel
    cancelCharge(player.aim);
  }
  // 'ending': hand over once the world has stayed settled for settleDelay.
  turn.settleTimer = settled ? turn.settleTimer + dt : 0;
  if (turn.settleTimer < cfg.settleDelay) return false;
  turn.active = (turn.active + 1) % players.length;
  turn.phase = 'play';
  turn.endRequested = false;
  turn.settleTimer = 0;
  turn.number++;
  return true;
}
