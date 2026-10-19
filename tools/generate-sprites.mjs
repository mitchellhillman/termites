// Sprite generator. Run from the repo root:  node tools/generate-sprites.mjs
// Turns the ASCII pixel art below into white-on-transparent RGBA PNG sprite sheets
// in sprites/ (no dependencies). The game loads the PNGs, not this file, so the
// PNGs can also be edited by hand afterwards; re-running this overwrites them.
//
// Each sheet is one row of frames, left to right, in the order balance.json
// lists them (balance.sprites.<name>.frames), each frameWidth x frameHeight.
// The game tints every non-transparent pixel to the team color at load, keeping
// the gray level as brightness, so draw in white and use gray only for shading.
//
// Pixel key:
//   .  transparent
//   #  white
//   +  light gray (shading)
//   :  dark gray (deep shading)
// A sprite drawn at `scale` 2 is written with every ASCII pixel as a 2x2 block.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodePNG } from "./png.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const balance = JSON.parse(readFileSync(join(root, "balance.json"), "utf8"));

const PALETTE = {
  ".": [255, 0, 255, 255],
  "#": [255, 255, 255, 255],
  "+": [170, 170, 170, 255],
  ":": [110, 110, 110, 255],
};

// --- art ---------------------------------------------------------------------
// Everything faces right (the game mirrors it for facing left). Drones are drawn
// walking right with their legs down; the game rotates them to the wall they cling to.

const ART = {
  drone: {
    scale: 1,
    frames: {
      walk1: [".##.......#.", "####.###.##.", "############", "..#.#...#.#."],
      walk2: [".##.......#.", "####.###.##.", "############", ".#...#.#...#"],
    },
  },

  soldier: {
    scale: 1,
    frames: {
      idle: [
        "...####.....",
        "..######....",
        ".########...",
        "..####.#....",
        "..######....",
        "...####.....",
        "....##......",
        "..######....",
        ".########...",
        ".###++##....",
        ".##::::::::#",
        ".##:##:.....",
        ".####.:.....",
        ".######.....",
        "..#####.....",
        "..#####.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.###....",
        ".###.###....",
      ],
      walk1: [
        "...####.....",
        "..######....",
        ".########...",
        "..####.#....",
        "..######....",
        "...####.....",
        "....##......",
        "..######....",
        ".########...",
        ".###++##....",
        ".##::::::::#",
        ".##:##:.....",
        ".####.:.....",
        ".######.....",
        "..#####.....",
        "..#####.....",
        "..##.##.....",
        ".##...##....",
        ".##...##....",
        "##.....##...",
        "##.....##...",
        "##......##..",
        "##......###.",
        "###......##.",
      ],
      walk2: [
        "...####.....",
        "..######....",
        ".########...",
        "..####.#....",
        "..######....",
        "...####.....",
        "....##......",
        "..######....",
        ".########...",
        ".###++##....",
        ".##::::::::#",
        ".##:##:.....",
        ".####.:.....",
        ".######.....",
        "..#####.....",
        "..#####.....",
        "..##.##.....",
        "..##.##.....",
        "...###......",
        "...###......",
        "..##.##.....",
        "..##.##.....",
        "..##.###....",
        ".###.###....",
      ],
      aimMid: [
        "...####.....",
        "..######....",
        ".########...",
        "..####.#....",
        "..######...:",
        "...####...::",
        "....##...::.",
        "..######::..",
        ".######::...",
        ".##+#::#....",
        ".###:##.....",
        ".######.....",
        ".######.....",
        ".######.....",
        "..#####.....",
        "..#####.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.###....",
        ".###.###....",
      ],
      aimHigh: [
        "........:...",
        "...####.:...",
        "..######:...",
        ".#######:...",
        "..####.#:...",
        "..######:...",
        "...####.:...",
        "....##.#:...",
        "..#####:#...",
        ".##+##:##...",
        ".###:####...",
        ".######.....",
        ".######.....",
        ".######.....",
        "..#####.....",
        "..#####.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.##.....",
        "..##.###....",
        ".###.###....",
      ],
    },
  },

  // 32x32 art written at 2x: a 64x64 queen.
  queen: {
    scale: 2,
    frames: {
      idle: [
        "................................",
        "......................#.#.#..#..",
        "......................#####...#.",
        ".....................#######.#..",
        "....................#########...",
        "....................#####:###...",
        "....................#####:###...",
        "....................#########...",
        ".....................#######:...",
        "......#########.......#####.:...",
        "...###############...######.....",
        "..#################.#######.....",
        ".####+####+####+##########......",
        ".####+####+####+##########......",
        "#####+####+####+##########......",
        "#####+####+####+##########......",
        "#####+####+####+##########......",
        "#####+####+####+##########......",
        "#####+####+####+###.######......",
        "#####+####+####+###.######......",
        ".####+####+####+###..####.......",
        ".####+####+####+###..####.......",
        "..#################.##..##......",
        "...###############.##....##.....",
        "......#########...##......##....",
        ".......##..##.....##......##....",
        "......##..##.....##........##...",
        ".....##..##......##........##...",
        "....##..##......##..........##..",
        "...##..##.......##..........##..",
        "..###.###......###..........###.",
        "..###.###......###..........###.",
      ],
    },
  },

  skull: {
    scale: 1,
    frames: {
      skull: [
        ".#####.",
        "#######",
        "#..#..#",
        "#..#..#",
        "###.###",
        ".#####.",
        ".#.#.#.",
      ],
    },
  },

  cursor: {
    scale: 1,
    frames: {
      cursor: ["..#..", "..#..", "##.##", "..#..", "..#.."],
    },
  },
};

// --- build -------------------------------------------------------------------

function buildSheet(name, def, art) {
  const { frameWidth: fw, frameHeight: fh, frames } = def;
  const W = fw * frames.length;
  const pixels = Buffer.alloc(W * fh * 4); // all transparent
  frames.forEach((frameName, f) => {
    const rows = art.frames[frameName];
    if (!rows) throw new Error(`${name}: no art for frame "${frameName}"`);
    const s = art.scale;
    if (rows.length * s !== fh)
      throw new Error(
        `${name}.${frameName}: ${rows.length} rows x${s}, expected ${fh / s}`,
      );
    rows.forEach((row, y) => {
      if (row.length * s !== fw)
        throw new Error(
          `${name}.${frameName} row ${y}: ${row.length} chars x${s}, expected ${fw / s}`,
        );
      [...row].forEach((ch, x) => {
        if (!(ch in PALETTE))
          throw new Error(
            `${name}.${frameName} row ${y}: unknown pixel "${ch}"`,
          );
        const [r, g, b, a] = PALETTE[ch];
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const i = ((y * s + dy) * W + f * fw + x * s + dx) * 4;
            pixels[i] = r;
            pixels[i + 1] = g;
            pixels[i + 2] = b;
            pixels[i + 3] = a;
          }
        }
      });
    });
  });
  return { W, H: fh, png: encodePNG(W, fh, pixels, 4) };
}

for (const [name, def] of Object.entries(balance.sprites)) {
  const art = ART[name];
  if (!art)
    throw new Error(`no art for sprite "${name}" (listed in balance.json)`);
  const { W, H, png } = buildSheet(name, def, art);
  const outPath = join(root, def.file);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  console.log(
    `Wrote ${outPath} (${W}x${H}, ${def.frames.length} frame${def.frames.length > 1 ? "s" : ""}, ${png.length} bytes)`,
  );
}
