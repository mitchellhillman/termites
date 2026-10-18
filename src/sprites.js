// Sprites (slice 8): load the PNG sprite sheets listed in balance.sprites and
// pre-render one tinted copy per color at load, so drawing is a plain drawImage.
//
// Sheets are drawn white (and gray for shading) on transparent, one row of
// frames each (tools/generate-sprites.mjs writes them; they can be hand-edited).
// Tinting multiplies by the color, so white becomes the color and gray a darker
// shade of it, then the sheet's own alpha is put back.

async function loadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function tint(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  return c;
}

/**
 * Load every sheet in balance.sprites and tint it once for each of `colors`
 * (hex strings). Returns { sheet(name, color), frameIndex(name, frameName), def(name) }.
 */
export async function loadSprites(balance, colors) {
  const defs = balance.sprites;
  const tinted = {}; // name -> color -> canvas
  await Promise.all(
    Object.entries(defs).map(async ([name, def]) => {
      const img = await loadImage(def.file);
      tinted[name] = {};
      for (const color of new Set(colors)) tinted[name][color] = tint(img, color);
    }),
  );
  return {
    def: (name) => defs[name],
    frameIndex: (name, frameName) => Math.max(0, defs[name].frames.indexOf(frameName)),
    sheet(name, color) {
      const sheet = tinted[name][color];
      if (!sheet) throw new Error(`sprite "${name}" was not tinted ${color}`);
      return sheet;
    },
  };
}

/**
 * Draw one frame of a sheet with its top-left at (x, y), in `color`. flipX
 * mirrors it (sprites face right), scale is a whole-number zoom. Positions are
 * rounded so pixels stay crisp.
 */
export function drawFrame(ctx, sprites, name, frame, color, x, y, flipX = false, scale = 1) {
  const { frameWidth: fw, frameHeight: fh } = sprites.def(name);
  const sheet = sprites.sheet(name, color);
  const w = fw * scale;
  const h = fh * scale;
  x = Math.round(x);
  y = Math.round(y);
  if (!flipX) {
    ctx.drawImage(sheet, frame * fw, 0, fw, fh, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w, y);
  ctx.scale(-1, 1);
  ctx.drawImage(sheet, frame * fw, 0, fw, fh, 0, 0, w, h);
  ctx.restore();
}

/**
 * Draw a frame centered on (cx, cy) through the 2x2 matrix [ax ay; nx ny]: the
 * sprite's right (+x) goes to (ax, ay) and its down (+y) to (nx, ny). Every entry
 * is -1, 0 or 1, so the 90-degree turns and mirrors stay pixel-crisp. The
 * transform is reset to identity afterwards.
 */
export function drawFrameOriented(ctx, sprites, name, frame, color, cx, cy, ax, ay, nx, ny) {
  const { frameWidth: fw, frameHeight: fh } = sprites.def(name);
  ctx.setTransform(ax, ay, nx, ny, cx, cy);
  ctx.drawImage(sprites.sheet(name, color), frame * fw, 0, fw, fh, -fw / 2, -fh / 2, fw, fh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
