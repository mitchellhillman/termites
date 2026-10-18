// Shots (slice 4): aiming, the PWR "quicktime" bar, projectile flight, blast
// radius from impact angle, blast damage, and the explosion effect.
//
// Everything except the draw* functions is pure math with no DOM, so it can be
// tested in node. Flight runs against the same `world` as units.js
// ({ width, height, isSolid(x, y) }). Angles are degrees: 0 = horizontal, 90 =
// straight up. Screen y grows downward, so "up" is negative vy.

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- Aim and power --------------------------------------------------------------

/** Per-player shooting state: walk/shoot mode, aim angle, and the PWR bar. */
export function createAim(cfg) {
  return {
    mode: 'walk', // 'walk' | 'shoot'
    angle: cfg.startAngle,
    charging: false, // PWR bar showing (first Fire press made)
    phase: 0, // PWR sweep position, in sweeps (0..2 is one full up-and-down cycle)
  };
}

/** Rotate the aim by walkDir (-1, 0, 1) for dt seconds; the cursor moves the way the key points. */
export function moveAim(aim, walkDir, facing, dt, cfg) {
  // Facing right, D (right) lowers the cursor toward the right-hand horizontal;
  // facing left, A does. Either way the cursor slides in the pressed direction.
  aim.angle = clamp(aim.angle - walkDir * facing * cfg.aimSpeed * dt, 0, 90);
}

/** Point on the aim arc (the cursor position) around center (cx, cy). */
export function aimPoint(cx, cy, angle, facing, radius) {
  return { x: cx + Math.cos(angle * DEG) * radius * facing, y: cy - Math.sin(angle * DEG) * radius };
}

/** PWR marker position 0..1 from the sweep phase: a triangle wave, up then back down. */
export function powerFromPhase(phase) {
  const p = phase % 2;
  return p <= 1 ? p : 2 - p;
}

/** Current PWR marker position 0..1. */
export const currentPower = (aim) => powerFromPhase(aim.phase);

/** Advance the PWR sweep. cfg.powerSweepSpeed is bottom-to-top sweeps per second. */
export function updateCharge(aim, dt, cfg) {
  if (aim.charging) aim.phase = (aim.phase + cfg.powerSweepSpeed * dt) % 2;
}

/**
 * A Fire press. The first press starts the PWR bar; it is refused (returns null,
 * nothing changes) when pool.ap < cfg.apCost. The second press locks the power,
 * spends cfg.apCost AP from pool, and returns { power } (0..1) for the shot.
 * Returns null on presses that don't fire.
 */
export function pressFire(aim, pool, cfg) {
  if (!aim.charging) {
    if (pool.ap < cfg.apCost) return null;
    aim.charging = true;
    aim.phase = 0;
    return null;
  }
  aim.charging = false;
  if (pool.ap < cfg.apCost) return null; // AP vanished mid-charge (can't happen in play)
  pool.ap -= cfg.apCost;
  return { power: powerFromPhase(aim.phase) };
}

/** Put away the PWR bar without firing (no AP spent). */
export function cancelCharge(aim) {
  aim.charging = false;
  aim.phase = 0;
}

/** Launch speed in px/s for a power of 0..1. */
export const launchSpeed = (power, cfg) => cfg.minSpeed + (cfg.maxSpeed - cfg.minSpeed) * clamp(power, 0, 1);

// --- Projectile -----------------------------------------------------------------

const pointInRect = (x, y, u) => x >= u.x && x < u.x + u.w && y >= u.y && y < u.y + u.h;

/**
 * A shot launched from (x, y) at `angle` toward `facing` with `speed` px/s.
 * `owner` is the unit that fired it: it starts inside the owner's rect, so the
 * owner is ignored until the shot has left that rect once (after that it can
 * hit the owner, e.g. a shot fired straight up that falls back down).
 */
export function createShot(x, y, angle, facing, speed, owner = null) {
  return {
    x,
    y,
    vx: Math.cos(angle * DEG) * speed * facing,
    vy: -Math.sin(angle * DEG) * speed,
    t: 0,
    owner,
    ownerClear: !owner || !pointInRect(x, y, owner),
  };
}

/**
 * Advance a shot by dt under gravity cfg.gravity (px/s^2, down) in sub-steps that
 * move at most cfg.subStepPx each, so it can't skip over thin dirt or a unit.
 * Each sub-step is integrated exactly, so the path is a true parabola.
 *
 * units: rects ({ x, y, w, h, dead? }) the shot explodes on.
 * Returns 'flying', 'lost' (left the left/right/bottom edge, or ran past
 * cfg.maxFlightTime), or 'impact'. On impact, shot.x/y is the first solid or
 * unit point touched, shot.vx/vy the velocity there, and shot.hitUnit the unit hit
 * (null for terrain). Above the top edge counts as open air, so shots arc back.
 */
export function stepShot(shot, dt, world, units, cfg) {
  const g = cfg.gravity;
  // Upper bound on distance moved this frame, to pick the number of sub-steps.
  const reach = (Math.abs(shot.vx) + Math.abs(shot.vy)) * dt + g * dt * dt;
  const n = Math.max(1, Math.ceil(reach / cfg.subStepPx));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    shot.x += shot.vx * h;
    shot.y += shot.vy * h + 0.5 * g * h * h;
    shot.vy += g * h;
    shot.t += h;
    if (shot.x < 0 || shot.x >= world.width || shot.y >= world.height) return 'lost';
    if (shot.t > cfg.maxFlightTime) return 'lost';
    if (!shot.ownerClear && !pointInRect(shot.x, shot.y, shot.owner)) shot.ownerClear = true;
    for (const u of units) {
      if (u.dead || (u === shot.owner && !shot.ownerClear)) continue;
      if (pointInRect(shot.x, shot.y, u)) {
        shot.hitUnit = u;
        return 'impact';
      }
    }
    if (shot.y >= 0 && world.isSolid(Math.floor(shot.x), Math.floor(shot.y))) {
      shot.hitUnit = null;
      return 'impact';
    }
  }
  return 'flying';
}

// --- Blast ----------------------------------------------------------------------

/** Angle of a velocity relative to horizontal, 0..90 degrees (up or down alike). */
export function impactAngle(vx, vy) {
  if (vx === 0 && vy === 0) return 0;
  return Math.atan2(Math.abs(vy), Math.abs(vx)) / DEG;
}

/** Blast radius: linear from minRadius at 0 degrees to maxRadius at 90, clamped. */
export function blastRadius(angle, minRadius, maxRadius) {
  return minRadius + (maxRadius - minRadius) * (clamp(angle, 0, 90) / 90);
}

/** True if a circle at (cx, cy) of radius r touches rect u (edge contact counts). */
export function circleHitsRect(cx, cy, r, u) {
  const nx = clamp(cx, u.x, u.x + u.w);
  const ny = clamp(cy, u.y, u.y + u.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/** Living units whose rect is inside or touching the blast circle. */
export function unitsInRadius(units, cx, cy, r) {
  return units.filter((u) => !u.dead && circleHitsRect(cx, cy, r, u));
}

/**
 * Every living unit in the blast takes 1 hit, friendly fire included. A unit with
 * hp (hits left) dies at 0. A unit is hit at most once per blast (1 hp max). Returns
 * the units hit. Soldiers, queens and drones are all in the list.
 */
export function damageUnitsInRadius(units, cx, cy, r) {
  const hit = unitsInRadius(units, cx, cy, r);
  for (const u of hit) {
    u.hp -= 1;
    if (u.hp <= 0) u.dead = true;
  }
  return hit;
}

// --- Explosion effect -------------------------------------------------------------

/**
 * Expanding blocky ring plus a few particles, at (x, y) growing to `radius`.
 * cfg: balance.explosion. rand: () => 0..1 (Math.random by default).
 */
export function createExplosion(x, y, radius, particleColor, cfg, rand = Math.random) {
  const particles = [];
  for (let i = 0; i < cfg.particleCount; i++) {
    const a = -Math.PI * rand(); // upward half
    const v = cfg.particleSpeed * (0.4 + 0.6 * rand());
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
  }
  return { x, y, radius, t: 0, particles, particleColor };
}

/** Advance the effect; returns false once it has finished. */
export function updateExplosion(e, dt, cfg) {
  e.t += dt;
  for (const p of e.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += cfg.particleGravity * dt;
  }
  return e.t < Math.max(cfg.ringDuration, cfg.particleLife);
}

export function drawExplosion(ctx, e, cfg) {
  ctx.save();
  const k = Math.min(1, e.t / cfg.ringDuration);
  if (k < 1) {
    const r = e.radius * (1 - (1 - k) * (1 - k)); // ease out
    const b = cfg.ringBlock;
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / b));
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = cfg.ringColor;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      // Snap to the block grid so the ring reads as chunky pixels.
      const bx = Math.round((e.x + Math.cos(a) * r) / b) * b;
      const by = Math.round((e.y + Math.sin(a) * r) / b) * b;
      ctx.fillRect(bx - b / 2, by - b / 2, b, b);
    }
  }
  const pk = Math.min(1, e.t / cfg.particleLife);
  if (pk < 1) {
    ctx.globalAlpha = 1 - pk;
    ctx.fillStyle = e.particleColor;
    const s = cfg.particleSize;
    for (const p of e.particles) ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
  }
  ctx.restore();
}

// --- Placeholder art (real sprites in slice 8) -------------------------------------

/** Aim cursor: a tiny team-colored plus sign on the arc. */
export function drawAimCursor(ctx, x, y, color) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 2, cy, 5, 1);
  ctx.fillRect(cx, cy - 2, 1, 5);
}

/** The shot: a small team-colored block, or a tick on the top edge while it is above the screen. */
export function drawShot(ctx, shot, color, size) {
  ctx.fillStyle = color;
  const x = Math.round(shot.x - size / 2);
  if (shot.y < 0) ctx.fillRect(x, 0, size, 2);
  else ctx.fillRect(x, Math.round(shot.y - size / 2), size, size);
}
