// Input. Keyboard is filled in by slice 3 (P1 keys) and slice 5 (P2 keys).
// Slice 2: the debug click-to-explode harness (gated by balance.debug.clickToExplode).

import { explode } from './terrain.js';

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
