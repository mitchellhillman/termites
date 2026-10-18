// HUD drawing. Slice 1: the always-on faint grid overlay.
// Slice 3: a temporary AP / walk readout (the real HUD is slice 8).
// Slice 4: mode and angle in the readout, and the PWR bar.
// Slice 5: per-player AP corners, the turn indicator and the coin flip announcement.

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

// Display names for KeyboardEvent.code bindings in the controls hint.
const KEY_LABELS = { ArrowLeft: '\u2190', ArrowRight: '\u2192', ArrowUp: '\u2191', ArrowDown: '\u2193', Slash: '/', Period: '.', Comma: ',' };
export const keyLabel = (code) => KEY_LABELS[code] || code.replace(/^(Key|Digit)/, '');

/**
 * One line of HUD text on a dark backing panel so it reads over any terrain.
 * (x, y) is the anchor: `align` 'left' | 'right' | 'center', y the line's middle.
 * Returns the text width.
 */
function label(ctx, hud, text, x, y, align, color, font = hud.font, h = hud.lineHeight) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const w = Math.ceil(ctx.measureText(text).width);
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * hud.panelOpacity;
  ctx.fillStyle = hud.panelColor;
  ctx.fillRect(Math.floor(x0) - 2, Math.round(y - h / 2), w + 4, h);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return w;
}

/**
 * Temporary readout (the real HUD is slice 8). Each player's AP sits in their own
 * bottom corner (P1 left, P2 right); the active player's is in full color and
 * underlined, the other dimmed. Above the active player's corner: a status line
 * and a controls hint for that player only. (Debug text is top-left.)
 */
export function drawPlayerReadouts(ctx, balance, players, turn) {
  const { width, height } = balance.canvas;
  const hud = balance.hud;
  const lh = hud.lineHeight;
  const rowY = (row) => height - hud.margin - lh / 2 - row * lh; // row 0 = bottom line
  ctx.save();
  players.forEach((p, i) => {
    const right = i % 2 === 1;
    const active = turn.phase !== 'announce' && turn.active === i;
    const x = right ? width - hud.margin : hud.margin;
    const color = balance.teams[p.team].color;
    ctx.globalAlpha = active ? 1 : hud.inactiveOpacity;
    const w = label(ctx, hud, `${balance.teams[p.team].name}  AP ${p.ap}`, x, rowY(0), right ? 'right' : 'left', color);
    if (active) {
      ctx.fillStyle = color;
      ctx.fillRect(right ? x - w : x, rowY(0) + lh / 2 - 2, w, 1);
    }
  });
  ctx.globalAlpha = 1;

  if (turn.phase !== 'announce') {
    const p = players[turn.active];
    const right = turn.active % 2 === 1;
    const k = (action) => keyLabel(p.controls.bindings[action]);
    const { aim } = p;
    let status;
    if (turn.phase === 'ending') status = 'turn over...';
    else if (aim.mode === 'walk') status = `mode walk  walk ${Math.ceil(p.walkBudget.remaining)}px`;
    else status = `mode shoot  angle ${Math.round(aim.angle)}\u00b0`;
    const lr = `${k('left')}/${k('right')}`;
    const face = `${k('faceUp')}/${k('faceDown')} face`;
    const hint =
      aim.mode === 'walk'
        ? `(${lr} walk, ${face}, ${k('mode')} shoot mode, ${k('endTurn')} end turn)`
        : `(${lr} aim, ${face}, ${k('fire')} power/fire, ${k('mode')} walk mode, ${k('endTurn')} end turn)`;
    const x = right ? width - hud.margin : hud.margin;
    const align = right ? 'right' : 'left';
    label(ctx, hud, hint, x, rowY(1), align, hud.color);
    label(ctx, hud, status, x, rowY(2), align, hud.color);
  }
  ctx.restore();
}

/** "Player 1 turn" in the top-right corner, in the team color. */
export function drawTurnIndicator(ctx, balance, players, turn) {
  if (turn.phase === 'announce') return;
  const team = balance.teams[players[turn.active].team];
  const hud = balance.hud;
  ctx.save();
  label(ctx, hud, `${team.name} turn`, balance.canvas.width - hud.margin, hud.margin + hud.lineHeight / 2, 'right', team.color);
  ctx.restore();
}

/** Coin flip result, centered, while the turn state is in its 'announce' phase. */
export function drawAnnouncement(ctx, balance, players, turn) {
  if (turn.phase !== 'announce') return;
  const team = balance.teams[players[turn.first].team];
  const { width, height } = balance.canvas;
  const hud = balance.hud;
  ctx.save();
  label(ctx, hud, 'Coin flip!', width / 2, height / 2 - 14, 'center', hud.color);
  label(ctx, hud, `${team.name} goes first`, width / 2, height / 2 + 4, 'center', team.color, hud.announceFont, hud.announceLineHeight);
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
