// Units (soldiers, queens, drones). Slice 3: one soldier that falls, walks and
// climbs, plus the walk budget. Slice 4: hit points and a placeholder death.
// Slice 6: queens (3 hp, health dots, fall like soldiers). Slice 7: drones that
// wander, tunnel and cling to dirt on their own.
//
// Movement is pure grid math against a `world` ({ width, height, isSolid(x, y) },
// plus resistanceAt(x, y) and dig(x, y, r) for drones) with no DOM, so it can be
// tested in node against a synthetic grid. Soldier and queen positions are whole
// pixels (x, y = top-left of the rect); fractional speed is accumulated. Drones
// keep a fractional center (cx, cy) and derive their rect from it.

/** True if a w x h rect at (x, y) is inside the map and overlaps no solid pixel. */
export function rectFree(world, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > world.width || y + h > world.height) return false;
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) if (world.isSolid(xx, yy)) return false;
  }
  return true;
}

/** True if a w x h rect at (x, y) has solid ground (or the map bottom) right under its feet. */
export function floorAt(world, x, y, w, h) {
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
 * A unit stays put if there is dirt under its feet, or (soldiers only) if it is
 * mid-climb and the wall it is climbing still touches it. Otherwise it falls.
 * Works for any { x, y, w, h, clingDir? } rect, so queens use it too.
 */
export function isSupported(world, s) {
  return floorAt(world, s.x, s.y, s.w, s.h) || clingWall(world, s);
}

/**
 * Spawn position for a w x h unit centered on centerX: scan down from row fromY
 * to the first solid pixel under its footprint and stand on it. Scanning from the
 * top (the default) lands on the surface, never inside a chamber below it; a
 * queen scans from a row inside its chamber to find the chamber floor.
 */
export function findSurfaceSpawn(world, centerX, w, h, fromY = 0) {
  const x = Math.min(world.width - w, Math.max(0, Math.round(centerX - w / 2)));
  for (let y = Math.max(0, Math.round(fromY)); y < world.height; y++) {
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
 * Gravity for any unit ({ x, y, w, h, vy, fallAccum }): accelerate by cfg.gravity
 * up to cfg.maxFallSpeed and drop whole pixels until something is under its feet.
 * Each step only checks the row under the feet, so a unit whose body grazes dirt
 * (a queen's corners against its chamber's rounded roof) still falls freely.
 * No fall damage. Call it only while the unit is unsupported.
 */
export function fall(world, u, dt, cfg) {
  u.vy = Math.min(cfg.maxFallSpeed, u.vy + cfg.gravity * dt);
  u.fallAccum += u.vy * dt;
  while (u.fallAccum >= 1) {
    if (floorAt(world, u.x, u.y, u.w, u.h)) break;
    u.y++;
    u.fallAccum -= 1;
  }
  if (floorAt(world, u.x, u.y, u.w, u.h)) {
    u.vy = 0; // landed
    u.fallAccum = 0;
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
    fall(world, s, dt, cfg);
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
 * where the unit stood, as wide as the unit (soldier or queen).
 */
export function drawDeadUnit(ctx, s, color) {
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

export const drawDeadSoldier = drawDeadUnit;

// --- Queen -------------------------------------------------------------------------

/**
 * A queen: never moves on its own, falls (no fall damage) when the dirt under it
 * goes, and takes cfg.hitsToKill blast hits (shots.js damageUnitsInRadius).
 */
export function createQueen(team, x, y, cfg, facing = 1) {
  return {
    team,
    kind: 'queen',
    x,
    y,
    w: cfg.width,
    h: cfg.height,
    facing,
    vy: 0,
    fallAccum: 0,
    maxHp: cfg.hitsToKill,
    hp: cfg.hitsToKill,
    dead: false,
  };
}

/** Queen on the floor of its chamber: scan down from cfg.spawnScanY at centerX. */
export function spawnQueen(world, team, centerX, cfg, facing = 1) {
  const spot = findSurfaceSpawn(world, centerX, cfg.width, cfg.height, cfg.spawnScanY);
  return createQueen(team, spot.x, spot.y, cfg, facing);
}

/** Queens only obey gravity. */
export function updateQueen(world, q, dt, cfg) {
  if (q.dead) return;
  if (isSupported(world, q)) {
    q.vy = 0;
    q.fallAccum = 0;
    return;
  }
  fall(world, q, dt, cfg);
}

/** Health dots, left to right: true = health remaining (filled), false = hit taken (hollow). */
export function healthDots(q) {
  return Array.from({ length: q.maxHp }, (_, i) => i < Math.max(0, q.hp));
}

// A pixel-art dot: every pixel within radius r of the dot's center (filled), or
// just the outer 1px ring (hollow). Whole-pixel fillRects keep it crisp.
function drawDot(ctx, cx, cy, r, filled) {
  for (let dy = -r; dy < r; dy++) {
    for (let dx = -r; dx < r; dx++) {
      const d = Math.hypot(dx + 0.5, dy + 0.5);
      if (d > r || (!filled && d <= r - 1)) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

/** Health dots centered over the queen's head, in the team color. cfg: balance.queen.dots. */
export function drawHealthDots(ctx, q, color, cfg) {
  const dots = healthDots(q);
  const step = cfg.radius * 2 + cfg.spacing;
  const total = dots.length * step - cfg.spacing;
  const x0 = Math.round(q.x + q.w / 2 - total / 2) + cfg.radius;
  const cy = Math.round(q.y - cfg.gap - cfg.radius);
  ctx.fillStyle = color;
  dots.forEach((full, i) => drawDot(ctx, x0 + i * step, cy, cfg.radius, full));
}

/**
 * Placeholder queen art (the real sprite is slice 8): a big blocky body in the
 * team color, with stepped corners, a head on the side it faces, an eye and legs.
 */
export function drawQueen(ctx, q, color, eyeColor) {
  const { x, y, w, h, facing } = q;
  ctx.fillStyle = color;
  const legH = Math.round(h * 0.12);
  const bodyTop = y + Math.round(h * 0.3);
  const bodyBottom = y + h - legH;
  const step = 4;
  // Abdomen: a wide block with stepped corners.
  ctx.fillRect(x + step, bodyTop, w - 2 * step, bodyBottom - bodyTop);
  ctx.fillRect(x, bodyTop + step, w, bodyBottom - bodyTop - 2 * step);
  // Head and crown on the facing side.
  const headW = Math.round(w * 0.38);
  const headX = facing > 0 ? x + w - headW : x;
  ctx.fillRect(headX, y + Math.round(h * 0.1), headW, Math.round(h * 0.3));
  for (let i = 0; i < 3; i++) ctx.fillRect(headX + 2 + i * Math.round((headW - 6) / 2), y, 2, Math.round(h * 0.1));
  // Legs.
  for (let i = 0; i < 4; i++) ctx.fillRect(x + 6 + i * Math.round((w - 16) / 3), bodyBottom, 4, legH);
  // Eye, and a few stripes across the abdomen in the background color.
  ctx.fillStyle = eyeColor;
  const eyeX = facing > 0 ? x + w - 8 : x + 4;
  ctx.fillRect(eyeX, y + Math.round(h * 0.18), 4, 4);
  const stripeX0 = facing > 0 ? x + 8 : x + headW + 4;
  for (let i = 0; i < 3; i++) ctx.fillRect(stripeX0 + i * 8, bodyTop + 6, 2, bodyBottom - bodyTop - 12);
}

// --- Drone -------------------------------------------------------------------------
//
// Drones move on their own in real time, never under player control. Each drone
// is in one of three states:
//
//   falling - nothing solid within supportRadius of its center (digRadius +
//             touchMargin, i.e. just past its own tunnel wall), e.g. a blast
//             cleared all the dirt around it. It drops under gravity until dirt
//             is within hugRadius (bodyRadius + touchMargin), or the map bottom.
//   'walk'  - clinging to an open surface: the ground, a chamber, or the walls,
//             floor or ceiling of a tunnel. It never digs. Each 1px step keeps
//             its body (a bodyRadius disk) out of the dirt and the dirt within
//             hugRadius, turning as little as possible from its heading to do
//             so: that follows floors, climbs walls and crawls along ceilings in
//             any orientation. Away from a wall but still supported (the middle
//             of a tunnel), it first crawls straight to the nearest dirt.
//             Each second there is a surfaceDigChance it starts a new tunnel
//             ('dig'), give or take digSpread: straight down when on the open
//             surface (nothing solid above it), toward the middle of the map
//             when underground (so drones work their way out of the chambers).
//   'dig'   - tunneling. It moves along its heading, which wanders (a random
//             turn rate re-rolled every ~turnInterval s, up to turnRate) and is
//             pulled gently toward the middle of the map (centerPull), and
//             clears a digRadius circle around itself each 1px step. Speed is
//             speed x the resistance of the hardest dirt that step cuts into (1,
//             0.75, 0.5). If a step would cut into bedrock it turns around; if
//             a step would cut into no dirt at all (it broke out into open
//             space, or turned back into its own tunnel) it switches to 'walk'.
//
// So "underground vs surface" is just the mode: a drone digs only while its next
// step overlaps new dirt in 'dig' mode, and walking an open surface never digs.
// Open-space movement (walking) is always at full speed.
// Both modes turn around at the screen edges (centers stay edgeMargin inside).

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

// Pixel offsets within radius r of a point (squared distance < r^2), nearest
// first, as a flat [dx, dy, dx, dy, ...] array. Cached per radius.
const offsetCache = new Map();
function diskOffsets(r) {
  let offs = offsetCache.get(r);
  if (offs) return offs;
  const list = [];
  const n = Math.ceil(r);
  for (let dy = -n; dy <= n; dy++) {
    for (let dx = -n; dx <= n; dx++) if (dx * dx + dy * dy < r * r) list.push([dx, dy]);
  }
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  offs = Int16Array.from(list.flat());
  offsetCache.set(r, offs);
  return offs;
}

/**
 * Nearest solid pixel within r of (cx, cy) (measured from the rounded center), or
 * null. With `diggable`, only dirt that can be dug (resistance > 0) counts.
 */
export function nearestSolid(world, cx, cy, r, diggable = false) {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const offs = diskOffsets(r);
  for (let i = 0; i < offs.length; i += 2) {
    const x = x0 + offs[i];
    const y = y0 + offs[i + 1];
    if (world.isSolid(x, y) && (!diggable || world.resistanceAt(x, y) > 0)) return { x, y };
  }
  return null;
}

const supportRadius = (cfg) => cfg.digRadius + cfg.touchMargin;
const hugRadius = (cfg) => cfg.bodyRadius + cfg.touchMargin;
const droneInBounds = (world, x, y, cfg) =>
  x >= cfg.edgeMargin && y >= cfg.edgeMargin && x <= world.width - cfg.edgeMargin && y <= world.height - cfg.edgeMargin;

/**
 * Hit rect from the center: cfg.width x cfg.height (12x4) when heading mostly
 * sideways, turned on end (4x12) when heading mostly up or down (climbing a wall
 * or digging a shaft).
 */
export function syncDroneRect(d, cfg) {
  const sideways = Math.abs(Math.cos(d.heading)) >= Math.abs(Math.sin(d.heading));
  d.w = sideways ? cfg.width : cfg.height;
  d.h = sideways ? cfg.height : cfg.width;
  d.x = Math.round(d.cx - d.w / 2);
  d.y = Math.round(d.cy - d.h / 2);
}

/** A drone centered at (cx, cy), heading in radians (0 = right, y down). One hit kills it. */
export function createDrone(team, cx, cy, heading, cfg) {
  const d = {
    team,
    kind: 'drone',
    cx,
    cy,
    heading,
    mode: 'walk', // 'walk' | 'dig' (see above)
    falling: false,
    vy: 0,
    fallAccum: 0,
    moveAccum: 0, // fractional travel not yet stepped
    factor: 1, // speed factor from the dirt being dug (dig mode)
    turn: 0, // current wander turn rate, rad/s
    groundDir: Math.PI / 2, // direction of the dirt it last clung to (legs side)
    walked: 0, // px moved, drives the leg flicker
    hp: 1,
    dead: false,
    deadTime: 0, // seconds since death (main.js removes it after cfg.corpseTime)
    x: 0,
    y: 0,
    w: cfg.width,
    h: cfg.height,
  };
  syncDroneRect(d, cfg);
  return d;
}

/**
 * n new drones at a queen's base: on the floor under her, spread up to
 * cfg.spawnSpread px either side of her center, each heading left or right.
 * rand: () => 0..1.
 */
export function spawnDrones(queen, n, cfg, rand = Math.random) {
  const cx = queen.x + queen.w / 2;
  const cy = queen.y + queen.h - cfg.bodyRadius - 1; // just above the floor row
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (rand() * 2 - 1) * cfg.spawnSpread;
    out.push(createDrone(queen.team, x, cy, rand() < 0.5 ? 0 : Math.PI, cfg));
  }
  return out;
}

function diskHasSolid(world, cx, cy, r) {
  return nearestSolid(world, cx, cy, r) !== null;
}

/** One 1px walking step (never digs). Returns true if the drone moved. */
function walkStep(world, d, cfg) {
  const hug = nearestSolid(world, d.cx, d.cy, hugRadius(cfg));
  if (!hug) {
    // Supported but not against anything (middle of a tunnel): crawl to the nearest wall.
    const t = nearestSolid(world, d.cx, d.cy, supportRadius(cfg));
    if (!t) return false;
    const a = Math.atan2(t.y - d.cy, t.x - d.cx);
    const nx = d.cx + Math.cos(a);
    const ny = d.cy + Math.sin(a);
    if (!droneInBounds(world, nx, ny, cfg) || diskHasSolid(world, nx, ny, cfg.bodyRadius)) return false;
    d.cx = nx;
    d.cy = ny;
    d.groundDir = a;
    return true;
  }
  d.groundDir = Math.atan2(hug.y - d.cy, hug.x - d.cx);
  // Turn as little as possible: try the heading, then +-step, +-2 step, ... to +-180.
  const step = cfg.walkSearchStep * DEG;
  const n = Math.ceil(Math.PI / step);
  for (let k = 0; k <= n; k++) {
    for (const s of k === 0 ? [0] : [1, -1]) {
      const a = d.heading + s * k * step;
      const nx = d.cx + Math.cos(a);
      const ny = d.cy + Math.sin(a);
      if (!droneInBounds(world, nx, ny, cfg)) continue;
      if (diskHasSolid(world, nx, ny, cfg.bodyRadius)) continue; // would push into dirt
      if (!nearestSolid(world, nx, ny, hugRadius(cfg))) continue; // would let go
      d.cx = nx;
      d.cy = ny;
      d.heading = wrapAngle(a);
      return true;
    }
  }
  d.heading = wrapAngle(d.heading + Math.PI); // boxed in: turn around
  return false;
}

/** One 1px tunneling step. Returns true if the drone moved. */
function digStep(world, d, cfg, rand) {
  let hx = Math.cos(d.heading);
  let hy = Math.sin(d.heading);
  const nx = d.cx + hx;
  const ny = d.cy + hy;
  // Screen edges: bounce off (flip the component heading out of the map).
  const m = cfg.edgeMargin;
  if (nx < m || nx > world.width - m || ny < m || ny > world.height - m) {
    if (nx < m || nx > world.width - m) hx = -hx;
    if (ny < m || ny > world.height - m) hy = -hy;
    d.heading = Math.atan2(hy, hx);
    return false;
  }
  // The pixels this step newly covers: inside the next circle, outside the current one.
  const r = cfg.digRadius;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(nx - r));
  const y0 = Math.max(0, Math.floor(ny - r));
  const x1 = Math.min(world.width - 1, Math.ceil(nx + r));
  const y1 = Math.min(world.height - 1, Math.ceil(ny + r));
  let diggable = 0;
  let minRes = 1;
  let blocked = 0; // undiggable pixels in the way, and their summed offsets from the drone
  let bx = 0;
  let by = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - nx) ** 2 + (y - ny) ** 2 >= r2) continue;
      if ((x - d.cx) ** 2 + (y - d.cy) ** 2 < r2) continue;
      if (!world.isSolid(x, y)) continue;
      const res = world.resistanceAt(x, y);
      if (!(res > 0)) {
        blocked++;
        bx += x - d.cx;
        by += y - d.cy;
        continue;
      }
      diggable++;
      if (res < minRes) minRes = res;
    }
  }
  if (blocked) {
    // Bedrock (undiggable) ahead: turn around, mirrored off its surface (a head-on
    // hit reverses; a glancing one bounces off along it), give or take reverseJitter.
    const len = Math.hypot(bx, by) || 1;
    const ux = bx / len;
    const uy = by / len;
    const dot = hx * ux + hy * uy;
    const a = Math.atan2(hy - 2 * dot * uy, hx - 2 * dot * ux);
    d.heading = wrapAngle(a + (rand() * 2 - 1) * cfg.reverseJitter * DEG);
    return false;
  }
  if (!diggable) {
    d.mode = 'walk'; // broke out into open space: walk from here
    return walkStep(world, d, cfg);
  }
  d.factor = minRes;
  d.cx = nx;
  d.cy = ny;
  world.dig(nx, ny, r);
  return true;
}

/** Direction from the drone to the middle of the map. */
const towardMiddle = (world, d) => Math.atan2(world.height / 2 - d.cy, world.width / 2 - d.cx);

/** On the open surface: nothing solid straight above the drone, all the way up. */
function onOpenSurface(world, d) {
  const x = Math.round(d.cx);
  for (let y = Math.round(d.cy) - 1; y >= 0; y--) if (world.isSolid(x, y)) return false;
  return true;
}

function fallDrone(world, d, dt, cfg) {
  const landed = () => d.cy >= world.height - cfg.edgeMargin || nearestSolid(world, d.cx, d.cy, hugRadius(cfg));
  d.vy = Math.min(cfg.maxFallSpeed, d.vy + cfg.gravity * dt);
  d.fallAccum += d.vy * dt;
  while (d.fallAccum >= 1 && !landed()) {
    d.cy = Math.min(world.height - cfg.edgeMargin, d.cy + 1);
    d.fallAccum -= 1;
  }
  if (landed()) {
    d.falling = false;
    d.vy = 0;
    d.fallAccum = 0;
  }
}

/**
 * Advance one drone by dt seconds (see the state notes above). rand: () => 0..1.
 * world: { width, height, isSolid, resistanceAt, dig }.
 */
export function updateDrone(world, d, dt, cfg, rand = Math.random) {
  if (d.dead) return;
  if (!d.falling && !nearestSolid(world, d.cx, d.cy, supportRadius(cfg))) {
    d.falling = true;
    d.mode = 'walk';
    d.moveAccum = 0;
  }
  if (d.falling) {
    fallDrone(world, d, dt, cfg);
    syncDroneRect(d, cfg);
    return;
  }

  if (d.mode === 'walk') {
    // Embedded in dirt (spawned inside it, or the map changed): dig out.
    if (diskHasSolid(world, d.cx, d.cy, cfg.bodyRadius)) d.mode = 'dig';
    else if (rand() < cfg.surfaceDigChance * dt) {
      // Start a new tunnel, give or take digSpread: straight down from the open
      // surface, toward the middle of the map from underground. If that way holds
      // no dirt, the first dig step finds none and it goes back to walking.
      const base = onOpenSurface(world, d) ? Math.PI / 2 : towardMiddle(world, d);
      d.heading = wrapAngle(base + (rand() * 2 - 1) * cfg.digSpread * DEG);
      d.mode = 'dig';
      d.factor = 1;
    }
  }
  if (d.mode === 'dig') {
    if (rand() < dt / cfg.turnInterval) d.turn = (rand() * 2 - 1) * cfg.turnRate * DEG;
    d.heading += d.turn * dt;
    // Gentle pull toward the middle of the map.
    const diff = wrapAngle(towardMiddle(world, d) - d.heading);
    const pull = cfg.centerPull * DEG * dt;
    d.heading = wrapAngle(d.heading + Math.max(-pull, Math.min(pull, diff)));
  }

  d.moveAccum += cfg.speed * (d.mode === 'dig' ? d.factor : 1) * dt;
  while (d.moveAccum >= 1) {
    d.moveAccum -= 1;
    const moved = d.mode === 'dig' ? digStep(world, d, cfg, rand) : walkStep(world, d, cfg);
    if (moved) d.walked++;
  }
  syncDroneRect(d, cfg);
}

/**
 * Placeholder drone art (the real 2-frame sprite is slice 8): a team-colored
 * rect with three 1px legs on the side of the dirt it clings to, shifting by a
 * pixel every cfg.legFrameDistance px walked.
 */
export function drawDrone(ctx, d, color, cfg) {
  ctx.fillStyle = color;
  ctx.fillRect(d.x, d.y, d.w, d.h);
  const shift = Math.floor(d.walked / cfg.legFrameDistance) % 2;
  const gx = Math.cos(d.groundDir);
  const gy = Math.sin(d.groundDir);
  if (d.w >= d.h) {
    const ly = gy < 0 ? d.y - 1 : d.y + d.h;
    for (let i = 0; i < 3; i++) ctx.fillRect(d.x + 1 + shift + i * 4, ly, 1, 1);
  } else {
    const lx = gx < 0 ? d.x - 1 : d.x + d.w;
    for (let i = 0; i < 3; i++) ctx.fillRect(lx, d.y + 1 + shift + i * 4, 1, 1);
  }
}
