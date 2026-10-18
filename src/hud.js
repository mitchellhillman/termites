// HUD drawing. Slice 1: the always-on faint grid overlay.
// Slice 3: a temporary AP / walk readout (the real HUD is slice 8).

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

/** Temporary readout for testing walking, in the bottom-left corner (debug text is top-left). */
export function drawWalkReadout(ctx, balance, player) {
  const { height } = balance.canvas;
  const debug = balance.debug;
  const key = debug.refillAPKey.replace(/^Key/, '');
  ctx.save();
  ctx.fillStyle = debug.color;
  ctx.font = debug.font;
  ctx.textBaseline = 'bottom';
  ctx.fillText(`AP ${player.ap}  walk ${Math.ceil(player.walkBudget.remaining)}px  (A/D walk, W/S face, ${key} refill AP)`, 4, height - 4);
  ctx.restore();
}
