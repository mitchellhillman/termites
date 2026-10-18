// Units (soldiers, queens, drones). Slice 3: one soldier that falls, walks and
// climbs, plus the walk budget. Slice 4: hit points and a placeholder death.
// Queens and drones come in slices 6 and 7.
//
// Movement is pure grid math against a `world` ({ width, height, isSolid(x, y) })
// with no DOM, so it can be tested in node against a synthetic grid. Positions are
// whole pixels (x, y = top-left of the rect); fractional speed is accumulated.

/** True if a w x h rect at (x, y) is inside the map and overlaps no solid pixel. */
export function rectFree(world, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > world.width || y + h > world.height) return false;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) if (world.isSolid(xx, yy)) return false;
  }
  return true;
}

/** True if a w x h rect at (x, y) has solid ground (or the map bottom) right under its feet. */
function floorAt(world, x, y, w, h) {
  const row = y + h;
  if (row >= world.height) return true;
  for (let xx = x; xx < x + w; xx++) if (world.isSolid(xx, row)) return true;
  return false;
}

/** True if the wall the soldier last climbed is still touching its side. */
function clingWall(world, s) {
  if (!s.clingDir) return false;
  const col = s.clingDir > 0 ? s.x + s.w : s.x - 1;
  if (col < 0 || col >= world.width) return false;
  for (let yy = s.y; yy < s.y + s.h; yy++) if (world.isSolid(col, yy)) return true;
  return false;
}

/**
 * A soldier stays put if there is dirt under its feet, or if it is mid-climb and
 * the wall it is climbing still touches it. Otherwise it falls.
 */
export function isSupported(world, s) {
  return floorAt(world, s.x, s.y, s.w, s.h) || clingWall(world, s);
}

/**
 * Spawn position for a w x h unit centered on centerX: scan down from the top of
 * the map to the first solid pixel under its footprint and stand on it. Scanning
 * from the top lands on the surface, never inside a chamber below it.
 */
export function findSurfaceSpawn(world, centerX, w, h) {
  const x = Math.min(world.width - w, Math.max(0, Math.round(centerX - w / 2)));
  for (let y = 0; y < world.height; y++) {
    for (let xx = x; xx < x + w; xx++) {
      if (world.isSolid(xx, y)) return { x, y: Math.max(0, y - h) };
    }
  }
  return { x, y: world.height - h };
}

export function createSoldier(team, x, y, cfg, facing = 1) {
  return {
    team,
    x,
    y,
    w: cfg.width,
    h: cfg.height,
    facing, // 1 = right, -1 = left
    vy: 0, // fall speed, px/s
    fallAccum: 0, // fractional fall distance not yet applied
    walkAccum: 0, // fractional walk distance not yet applied
    clingDir: 0, // side of the wall being climbed (1, -1), 0 when not climbing
    canStartWalk: true, // false after a walk spent AP, until the walk key is released
    hp: cfg.hitsToKill, // hits left; blasts take 1 (shots.js damageUnitsInRadius)
    dead: false,
  };
}

/**
 * Plan one walk step in direction dir (1 or -1) without changing anything.
 * Returns { x, y, cost, clingDir } or null if the soldier can't move.
 *
 * In order:
 *  1. Move 1px sideways. If that leaves no floor, snap down up to snapDownPx to
 *     follow a downhill slope; past that, the soldier walks off and falls.
 *  2. Blocked: step up and over a small bump (up to stepUpPx) in one step.
 *  3. Still blocked: climb 1px straight up the wall. Repeated steps carry it up a
 *     wall of any height and over the top. This is not a height limit.
 *  4. Blocked above too (wedged under an overhang) or at the map edge: no step.
 * Cost is the length of the step (hypot of its dx, dy), so walk travel is measured
 * along the path actually moved, climbing included.
 */
export function planWalkStep(world, s, dir, cfg) {
  const { w, h } = s;
  const nx = s.x + dir;
  // The screen border is not a wall to climb.
  if (nx < 0 || nx + w > world.width) return null;

  if (rectFree(world, nx, s.y, w, h)) {
    let ny = s.y;
    if (!floorAt(world, nx, s.y, w, h)) {
      for (let k = 1; k <= cfg.snapDownPx; k++) {
        if (!rectFree(world, nx, s.y + k, w, h)) break;
        if (floorAt(world, nx, s.y + k, w, h)) {
          ny = s.y + k;
          break;
        }
      }
    }
    return { x: nx, y: ny, cost: Math.hypot(1, ny - s.y), clingDir: 0 };
  }

  for (let k = 1; k <= cfg.stepUpPx; k++) {
    // The straight-up path must be clear too, so a step never cuts a corner.
    if (!rectFree(world, s.x, s.y - k, w, h)) break;
    if (rectFree(world, nx, s.y - k, w, h)) return { x: nx, y: s.y - k, cost: Math.hypot(1, k), clingDir: 0 };
  }

  if (rectFree(world, s.x, s.y - 1, w, h)) return { x: s.x, y: s.y - 1, cost: 1, clingDir: dir };
  return null;
}

/**
 * Walk budget: starting to walk spends AP and unlocks pxPerAP of travel. Leftover
 * travel is thrown away by forfeit() (mode switch or turn end).
 * `pool` is anything with an `ap` number (the player).
 */
export class WalkBudget {
  constructor(pxPerAP, apCost) {
    this.pxPerAP = pxPerAP;
    this.apCost = apCost;
    this.remaining = 0;
  }

  /** True if a step could be paid for now (from leftover travel or by spending AP). */
  canWalk(pool, allowSpend = true) {
    return this.remaining > 0 || (allowSpend && pool.ap >= this.apCost);
  }

  /**
   * Pay for a step of `cost` px. With no travel left, spends AP to unlock more if
   * allowSpend. The last step is allowed whenever any travel remains, and the
   * remainder floors at 0. Returns false if the step can't be paid for.
   */
  take(cost, pool, allowSpend = true) {
    if (this.remaining <= 0) {
      if (!allowSpend || pool.ap < this.apCost) return false;
      pool.ap -= this.apCost;
      this.remaining = this.pxPerAP;
    }
    this.remaining = Math.max(0, this.remaining - cost);
    return true;
  }

  /** Lose any leftover travel. */
  forfeit() {
    this.remaining = 0;
  }
}

/**
 * Advance one soldier by dt seconds. walkDir is -1, 0 or 1 from the keys.
 * Unsupported soldiers fall (no walking mid-air); supported ones walk at walkSpeed
 * px/s along the path, paid for by `budget` from `pool`. Holding the walk key does
 * not spend a second AP when the budget runs out: release and press again.
 */
export function updateSoldier(world, s, dt, cfg, walkDir, budget, pool) {
  if (!walkDir) s.canStartWalk = true;

  if (!isSupported(world, s)) {
    s.clingDir = 0;
    s.walkAccum = 0;
    s.vy = Math.min(cfg.maxFallSpeed, s.vy + cfg.gravity * dt);
    s.fallAccum += s.vy * dt;
    while (s.fallAccum >= 1) {
      if (!rectFree(world, s.x, s.y + 1, s.w, s.h)) {
        s.fallAccum = 0;
        break;
      }
      s.y++;
      s.fallAccum -= 1;
    }
    if (floorAt(world, s.x, s.y, s.w, s.h)) {
      s.vy = 0; // landed
      s.fallAccum = 0;
    }
    return;
  }
  s.vy = 0;
  s.fallAccum = 0;

  if (!walkDir) {
    s.walkAccum = 0;
    return;
  }
  s.facing = walkDir;
  s.walkAccum += cfg.walkSpeed * dt;
  while (s.walkAccum > 0) {
    const step = planWalkStep(world, s, walkDir, cfg);
    if (!step) {
      s.walkAccum = 0; // blocked: don't build up speed against a wall
      break;
    }
    const spends = budget.remaining <= 0;
    if (!budget.take(step.cost, pool, s.canStartWalk)) {
      s.walkAccum = 0;
      break;
    }
    if (spends) s.canStartWalk = false;
    s.x = step.x;
    s.y = step.y;
    s.clingDir = step.clingDir;
    s.walkAccum -= step.cost;
    if (!isSupported(world, s)) break; // walked off a ledge: falls from next frame
  }
}

/**
 * Placeholder soldier art (real sprites in slice 8): a team-colored rect with an
 * eye and a gun nub on the side it faces.
 */
export function drawSoldier(ctx, s, color, eyeColor) {
  ctx.fillStyle = color;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  const front = s.facing > 0 ? s.x + s.w : s.x;
  ctx.fillRect(s.facing > 0 ? front : front - 4, s.y + 10, 4, 2);
  ctx.fillStyle = eyeColor;
  ctx.fillRect(s.facing > 0 ? front - 4 : front + 2, s.y + 3, 2, 2);
}

/**
 * Placeholder death (the real skull is slice 8): a dimmed team-colored X over
 * where the soldier stood.
 */
export function drawDeadSoldier(ctx, s, color) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = color;
  const size = s.w;
  const x0 = s.x;
  const y0 = s.y + s.h - size;
  for (let i = 0; i < size; i++) {
    ctx.fillRect(x0 + i, y0 + i, 2, 2);
    ctx.fillRect(x0 + size - 1 - i, y0 + i, 2, 2);
  }
  ctx.restore();
}
