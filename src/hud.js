// HUD drawing. Slice 1: the always-on faint grid overlay.

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
