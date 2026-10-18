// HUD drawing. Slice 1: the always-on faint grid overlay.
// Slice 3: a temporary AP / walk readout (the real HUD is slice 8).
// Slice 4: mode and angle in the readout, and the PWR bar.

export function drawGrid(ctx, balance) {
  const { width, height } = balance.canvas;
  const { spacing, color, opacity } = balance.grid;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  // 1px filled rects stay crisp (no half-pixel line blur).
  for (let x = 0; x < width; x += spacing) ctx.fillRect(x, 0, 1, height);
  for (let y = 0; y < height; y += spacing) ctx.fillRect(0, y, width, 1);
  ctx.restore();
}

/**
 * Temporary readout for testing walking and shooting, in the bottom-left corner
 * (debug text is top-left): a status line above a controls hint.
 */
export function drawWalkReadout(ctx, balance, player) {
  const { height } = balance.canvas;
  const debug = balance.debug;
  const key = debug.refillAPKey.replace(/^Key/, '');
  const { aim } = player;
  const status =
    aim.mode === 'walk'
      ? `AP ${player.ap}  mode walk  walk ${Math.ceil(player.walkBudget.remaining)}px`
      : `AP ${player.ap}  mode shoot  angle ${Math.round(aim.angle)}\u00b0`;
  const hint =
    aim.mode === 'walk'
      ? `(A/D walk, W/S face, Q shoot mode, ${key} refill AP)`
      : `(A/D aim, W/S face, E power/fire, Q walk mode, ${key} refill AP)`;
  ctx.save();
  ctx.fillStyle = debug.color;
  ctx.font = debug.font;
  ctx.textBaseline = 'bottom';
  ctx.fillText(status, 4, height - 16);
  ctx.fillText(hint, 4, height - 4);
  ctx.restore();
}

/**
 * The PWR "quicktime" bar beside the soldier, on its back side so it stays clear
 * of the aim cursor: a vertical gradient toward red at the top, with a white
 * marker at `power` (0 = bottom, 1 = top).
 */
export function drawPowerBar(ctx, balance, soldier, power) {
  const bar = balance.shot.powerBar;
  const { width } = balance.canvas;
  let x = soldier.facing > 0 ? soldier.x - bar.gap - bar.width : soldier.x + soldier.w + bar.gap;
  x = Math.min(width - bar.width, Math.max(0, x));
  const y = Math.max(10, soldier.y + soldier.h - bar.height);
  ctx.save();
  const grad = ctx.createLinearGradient(0, y + bar.height, 0, y);
  grad.addColorStop(0, bar.bottomColor);
  grad.addColorStop(0.5, bar.middleColor);
  grad.addColorStop(1, bar.topColor);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, bar.width, bar.height);
  ctx.fillStyle = bar.markerColor;
  const my = Math.round(y + (bar.height - 1) * (1 - power));
  ctx.fillRect(x - 2, my - 1, bar.width + 4, 2);
  ctx.fillStyle = bar.labelColor;
  ctx.font = bar.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('PWR', Math.min(width - 8, Math.max(8, x + bar.width / 2)), y - 2);
  ctx.restore();
}
