// HUD drawing. Slice 1: the always-on faint grid overlay.
// Slice 3: a temporary AP / walk readout (the real HUD is slice 8).
// Slice 4: mode and angle in the readout, and the PWR bar.
// Slice 5: per-player AP corners, the turn indicator and the coin flip announcement.
// Slice 6: the win screen.
// Slice 7: each side's drone count next to its AP.
// Slice 8: the full HUD (AP tokens, drone icon and count, mode, walk bar,
// controls hint) and the title screen.
//
// Layout: top right, "Player N turn" with the active player's controls hint
// under it. Bottom corners (P1 left, P2 right): each player's name, AP tokens
// and drone count; above the active player's line, their mode and walk budget
// bar. A corner fades (hud.occludedOpacity) while a soldier or queen is under it.

import { drawDot } from './units.js';
import { drawFrame } from './sprites.js';

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
 * AP tokens for a player, left to right: true = AP remaining (filled), false =
 * AP spent (or lost) since the start of their latest turn (hollow).
 */
export function apTokens(player) {
  const n = Math.max(player.apStart || 0, player.ap);
  return Array.from({ length: n }, (_, i) => i < player.ap);
}

/** The controls hint line for a player's current mode (key names via keyLabel). */
export function controlsHint(player) {
  const k = (action) => keyLabel(player.controls.bindings[action]);
  const lr = `${k('left')}/${k('right')}`;
  const face = `${k('faceUp')}/${k('faceDown')} face`;
  return player.aim.mode === 'walk'
    ? `${lr} walk  ${face}  ${k('mode')} shoot mode  ${k('endTurn')} end turn`
    : `${lr} aim  ${face}  ${k('fire')} power/fire  ${k('mode')} walk mode  ${k('endTurn')} end turn`;
}

const rectsOverlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A HUD row is a list of items laid out left to right with hud.itemGap between them:
//   { text, color }              a text run
//   { tokens: [bool], color }    AP tokens (pixel dots, filled or hollow)
//   { sprite, frame, color }     one sprite frame (e.g. the drone icon)
//   { bar: 0..1, color }         the walk budget bar
function itemWidth(ctx, hud, item, sprites) {
  if (item.text !== undefined) return Math.ceil(ctx.measureText(item.text).width);
  if (item.tokens) {
    const { radius, spacing } = hud.token;
    return Math.max(0, item.tokens.length * (radius * 2 + spacing) - spacing);
  }
  if (item.sprite) return sprites.def(item.sprite).frameWidth;
  if (item.bar !== undefined) return hud.walkBar.width + 2;
  return 0;
}

function rowWidth(ctx, hud, items, sprites) {
  ctx.font = hud.font;
  const widths = items.map((it) => itemWidth(ctx, hud, it, sprites));
  return { widths, total: widths.reduce((a, w) => a + w, 0) + hud.itemGap * Math.max(0, items.length - 1) };
}

/** Draw a row with its left edge at x0 and its middle at y, on a backing panel. */
function drawRow(ctx, hud, items, sprites, x0, y, layout) {
  const h = hud.lineHeight;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * hud.panelOpacity;
  ctx.fillStyle = hud.panelColor;
  ctx.fillRect(Math.floor(x0) - 2, Math.round(y - h / 2), layout.total + 4, h);
  ctx.globalAlpha = alpha;
  ctx.font = hud.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = Math.round(x0);
  items.forEach((it, i) => {
    const w = layout.widths[i];
    if (it.text !== undefined) {
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, x, y);
    } else if (it.tokens) {
      const { radius, spacing } = hud.token;
      ctx.fillStyle = it.color;
      it.tokens.forEach((full, k) => drawDot(ctx, x + radius + k * (radius * 2 + spacing), Math.round(y), radius, full));
    } else if (it.sprite) {
      const def = sprites.def(it.sprite);
      drawFrame(ctx, sprites, it.sprite, it.frame || 0, it.color, x, Math.round(y - def.frameHeight / 2));
    } else if (it.bar !== undefined) {
      const bar = hud.walkBar;
      const by = Math.round(y - bar.height / 2);
      ctx.globalAlpha = alpha * bar.backOpacity;
      ctx.fillStyle = bar.backColor;
      ctx.fillRect(x, by, bar.width + 2, bar.height);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = it.color;
      // 1px outline, then the fill for the remaining budget.
      ctx.fillRect(x, by, bar.width + 2, 1);
      ctx.fillRect(x, by + bar.height - 1, bar.width + 2, 1);
      ctx.fillRect(x, by, 1, bar.height);
      ctx.fillRect(x + bar.width + 1, by, 1, bar.height);
      const fill = Math.round(bar.width * Math.min(1, Math.max(0, it.bar)));
      if (fill > 0) ctx.fillRect(x + 1, by + 1, fill, bar.height - 2);
    }
    x += w + hud.itemGap;
  });
}

/**
 * Bottom corners, one per player (P1 left, P2 right): name, AP tokens and the
 * drone icon with the side's living drone count (droneCounts[i]). The active
 * player's corner is full strength and underlined, the other dimmed; above the
 * active player's line sits their mode with the walk budget bar (walk) or aim
 * angle (shoot). `occluders` are unit rects ({ x, y, w, h }): a corner fades
 * while one overlaps it, so a queen on the bedrock stays visible.
 */
export function drawPlayerReadouts(ctx, balance, sprites, players, turn, droneCounts = [], occluders = []) {
  const { width, height } = balance.canvas;
  const hud = balance.hud;
  const lh = hud.lineHeight;
  const rowY = (row) => height - hud.margin - lh / 2 - row * (lh + hud.rowGap); // row 0 = bottom line
  const inPlay = turn.phase === 'play' || turn.phase === 'ending';
  ctx.save();
  players.forEach((p, i) => {
    const team = balance.teams[p.team];
    const right = i % 2 === 1;
    const active = inPlay && turn.active === i;
    const tokens = apTokens(p);
    const rows = [
      [
        { text: team.short || team.name, color: team.color },
        { text: 'AP', color: hud.color },
        tokens.length ? { tokens, color: team.color } : { text: '-', color: hud.color },
        { sprite: 'drone', frame: 0, color: team.color },
        { text: String(droneCounts[i] ?? 0), color: hud.color },
      ],
    ];
    if (active) {
      const { aim } = p;
      if (turn.phase === 'ending') rows.push([{ text: hud.turnOverText, color: hud.color }]);
      else if (aim.mode === 'walk') {
        rows.push([
          { text: 'WALK', color: hud.color },
          { bar: p.walkBudget.remaining / p.walkBudget.pxPerAP, color: team.color },
        ]);
      } else rows.push([{ text: `SHOOT ${Math.round(aim.angle)}°`, color: hud.color }]);
    }
    const layouts = rows.map((r) => rowWidth(ctx, hud, r, sprites));
    const boxes = layouts.map((l, r) => ({
      x: right ? width - hud.margin - l.total - 2 : hud.margin - 2,
      y: Math.round(rowY(r) - lh / 2),
      w: l.total + 4,
      h: lh,
    }));
    const occluded = occluders.some((u) => boxes.some((b) => rectsOverlap(b, u)));
    ctx.globalAlpha = (active ? 1 : hud.inactiveOpacity) * (occluded ? hud.occludedOpacity : 1);
    rows.forEach((items, r) => drawRow(ctx, hud, items, sprites, boxes[r].x + 2, rowY(r), layouts[r]));
    if (active) {
      ctx.fillStyle = team.color;
      ctx.fillRect(boxes[0].x + 2, rowY(0) + lh / 2 - 2, layouts[0].total, 1);
    }
  });
  ctx.restore();
}

/**
 * Top right: "Player 1 turn" in the team color and, while they can act, the
 * active player's controls hint under it.
 */
export function drawTurnIndicator(ctx, balance, players, turn) {
  if (turn.phase === 'announce' || turn.phase === 'over') return;
  const p = players[turn.active];
  const team = balance.teams[p.team];
  const hud = balance.hud;
  const x = balance.canvas.width - hud.margin;
  const y = hud.margin + hud.lineHeight / 2;
  ctx.save();
  label(ctx, hud, `${team.name} turn`, x, y, 'right', team.color);
  if (turn.phase === 'play' && !turn.endRequested) label(ctx, hud, controlsHint(p), x, y + hud.lineHeight + hud.rowGap, 'right', hud.color);
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
 * Win screen, centered, once the game is over and the world has settled
 * (turn.resultShown): "Player N wins" in the winner's color, or "Draw", and the
 * restart prompt.
 */
export function drawWinScreen(ctx, balance, players, turn) {
  if (turn.phase !== 'over' || !turn.resultShown) return;
  const { width, height } = balance.canvas;
  const hud = balance.hud;
  const ws = balance.winScreen;
  const { winner, draw } = turn.result;
  const team = draw ? null : balance.teams[players[winner].team];
  const text = draw ? ws.drawText : `${team.name} wins`;
  const color = draw ? hud.color : team.color;
  ctx.save();
  label(ctx, hud, text, width / 2, height / 2, 'center', color, ws.font, ws.lineHeight);
  const prompt = `Press ${keyLabel(ws.restartKey)} to play again`;
  label(ctx, hud, prompt, width / 2, height / 2 + ws.lineHeight / 2 + ws.promptGap, 'center', hud.color);
  ctx.restore();
}

// Title screen controls list: [actions, description]; two actions share a line.
const TITLE_CONTROLS = [
  [['left', 'right'], 'walk / aim'],
  [['faceUp', 'faceDown'], 'flip facing'],
  [['mode'], 'walk / shoot mode'],
  [['fire'], 'power, then fire'],
  [['endTurn'], 'end turn'],
];

/**
 * Title screen over the (live) map: the game name, a one-line goal, each
 * player's controls from balance.controls with their soldier sprite, and a
 * blinking "press any key". t: seconds since the page started (for the blink).
 */
export function drawTitleScreen(ctx, balance, sprites, t) {
  const { width, height } = balance.canvas;
  const hud = balance.hud;
  const ts = balance.title;
  const cx = width / 2;
  const top = Math.round((height - ts.panelHeight) / 2);
  ctx.save();
  ctx.globalAlpha = ts.panelOpacity;
  ctx.fillStyle = hud.panelColor;
  ctx.fillRect(Math.round(cx - ts.panelWidth / 2), top, ts.panelWidth, ts.panelHeight);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hud.color;
  ctx.font = ts.font;
  ctx.fillText(ts.text, cx, top + 44);
  ctx.font = hud.font;
  ctx.fillText(ts.subtitle, cx, top + 80);

  const lh = hud.lineHeight + 4;
  ['p1', 'p2'].forEach((key, i) => {
    const team = balance.teams[i];
    const bindings = balance.controls[key];
    const colX = Math.round(cx + (i === 0 ? -1 : 1) * (ts.columnGap / 2));
    const headY = top + 120;
    const sdef = sprites.def('soldier');
    const sw = sdef.frameWidth * ts.spriteScale;
    ctx.font = ts.headingFont;
    const nameW = Math.ceil(ctx.measureText(team.name).width);
    const groupX = Math.round(colX - (sw + 6 + nameW) / 2);
    // Each soldier faces the middle, like on the map.
    drawFrame(ctx, sprites, 'soldier', 0, team.color, groupX, headY - (sdef.frameHeight * ts.spriteScale) / 2, team.facing < 0, ts.spriteScale);
    ctx.textAlign = 'left';
    ctx.fillStyle = team.color;
    ctx.fillText(team.name, groupX + sw + 6, headY);

    ctx.font = hud.font;
    const keyColW = 42;
    const x0 = Math.round(colX - 80);
    TITLE_CONTROLS.forEach(([actions, desc], r) => {
      const y = headY + 36 + r * lh;
      ctx.fillStyle = team.color;
      ctx.fillText(actions.map((a) => keyLabel(bindings[a])).join(' / '), x0, y);
      ctx.fillStyle = hud.color;
      ctx.fillText(desc, x0 + keyColW, y);
    });
  });

  if ((t / ts.blinkPeriod) % 1 < 0.6) {
    ctx.textAlign = 'center';
    ctx.font = ts.promptFont;
    ctx.fillStyle = hud.color;
    ctx.fillText(ts.promptText, cx, top + ts.panelHeight - 26);
  }
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
