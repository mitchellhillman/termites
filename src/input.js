// Input. Keyboard state (slice 3), mapped to per-player actions through the
// bindings in balance.controls.p1 / p2 (P2 from slice 5).
// Slice 2: the debug click-to-explode harness (gated by balance.debug.clickToExplode).
// Slice 8: anyPressed() for the title screen.

import { explode } from './terrain.js';

/**
 * Keyboard state by KeyboardEvent.code (layout-independent, e.g. "KeyA").
 * isDown(code): held right now. wasPressed(code): went down since the last
 * endFrame() (key auto-repeat ignored). anyPressed(): any key did. Call endFrame() once per frame after
 * reading input. `bound` codes have their browser default suppressed (arrow keys
 * scrolling, "/" quick find).
 */
export function setupKeyboard(bound = []) {
  const down = new Set();
  const pressed = new Set();
  const suppress = new Set(bound);

  window.addEventListener('keydown', (e) => {
    if (suppress.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
  });
  // Keys released while the tab is unfocused never send keyup.
  window.addEventListener('blur', () => down.clear());

  return {
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    anyPressed: () => pressed.size > 0,
    endFrame: () => pressed.clear(),
  };
}

/**
 * One player's actions ("left", "right", "faceUp", "faceDown", "mode", "fire",
 * "endTurn") read through their bindings, e.g. balance.controls.p1.
 */
export function playerControls(keyboard, bindings) {
  return {
    bindings,
    held: (action) => keyboard.isDown(bindings[action]),
    pressed: (action) => keyboard.wasPressed(bindings[action]),
    /** -1, 0 or 1 from the left/right keys (both held cancel out). */
    walkDir: () => (keyboard.isDown(bindings.right) ? 1 : 0) - (keyboard.isDown(bindings.left) ? 1 : 0),
  };
}

// Mouse position in map pixels. The canvas is CSS-scaled by a whole number, so
// divide out the displayed size rather than assuming 1:1.
function toMapCoords(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * canvas.width) / rect.width,
    y: ((e.clientY - rect.top) * canvas.height) / rect.height,
  };
}

/**
 * Debug harness: click or click-drag to explode at the cursor; mouse wheel or
 * [ and ] change the radius. Returns { draw(ctx) } for the on-screen overlay,
 * or null when balance.debug.clickToExplode is off.
 */
export function setupClickToExplode(canvas, balance) {
  const debug = balance.debug || {};
  if (!debug.clickToExplode) return null;

  const { minRadius, maxRadius } = balance.explosion;
  const clamp = (r) => Math.min(maxRadius, Math.max(minRadius, r));
  let radius = clamp(debug.clickExplosionRadius);
  let cursor = null; // { x, y } in map pixels, null when outside the canvas

  const blast = (e) => {
    cursor = toMapCoords(canvas, e);
    explode(cursor.x, cursor.y, radius);
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    blast(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) blast(e);
    else cursor = toMapCoords(canvas, e);
  });
  canvas.addEventListener('pointerleave', () => {
    cursor = null;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      radius = clamp(radius + (e.deltaY < 0 ? debug.radiusStep : -debug.radiusStep));
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (e.key === '[') radius = clamp(radius - debug.radiusStep);
    else if (e.key === ']') radius = clamp(radius + debug.radiusStep);
  });

  return {
    draw(ctx) {
      ctx.save();
      ctx.fillStyle = debug.color;
      ctx.font = debug.font;
      ctx.textBaseline = 'top';
      ctx.fillText(`blast r=${radius}  (click, wheel or [ ])`, 4, 4);
      if (cursor) {
        ctx.globalAlpha = debug.circleOpacity;
        ctx.strokeStyle = debug.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}
