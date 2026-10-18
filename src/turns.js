// Turns (slice 5): two players, the coin flip, per-turn AP, and when a turn ends.
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
//                falling) for cfg.settleDelay seconds.
//
// The last-AP walk: spending the last AP on walking leaves AP at 0 but unlocks
// 40px of travel. The 0-AP auto-end waits until that travel is used up or
// forfeited (mode switch or End Turn), so the last walk is never cut off. A player
// who stops partway keeps the turn until they press End Turn or switch modes.
//
// Mode: every turn starts in walk mode (aim angle and facing are kept).

import { WalkBudget, isSupported } from './units.js';
import { createAim, cancelCharge } from './shots.js';

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
    respawnTimer: 0, // debug auto-respawn (slice 7 replaces it with the queen rules)
  };
}

export function createTurnState(first, cfg) {
  return { active: first, first, phase: 'announce', timer: cfg.announceDuration, settleTimer: 0, endRequested: false, number: 0 };
}

/** AP granted at the start of a turn. Slice 7: floor(drones / 5). */
export function turnAP(player, cfg) {
  return cfg.fixedAP;
}

/**
 * Start-of-turn step for `player`. Slice 7 adds "queen spawns drones" here, before
 * the AP is set. Unused AP never carries over: AP is set, not added.
 */
export function startTurn(player, cfg) {
  player.ap = turnAP(player, cfg);
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

/** No shot flying, no explosion playing, and no living soldier falling. */
export function worldSettled(world, fx, soldiers) {
  if (fx.shot || fx.explosion) return false;
  return soldiers.every((s) => !s || s.dead || isSupported(world, s));
}

/**
 * Advance the turn state by dt. `players` is the array of both players, `settled`
 * the result of worldSettled() this frame. Returns true when a new turn begins
 * (turn.active is already the new player); the caller then runs startTurn().
 */
export function updateTurn(turn, dt, players, settled, cfg) {
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
