# Termites

A two-player, turn-based artillery and digging game for the browser. Two termite colonies share one keyboard and one dirt-filled screen. Each side has a queen in an underground chamber, one soldier on the surface, and a swarm of drones that wander and tunnel through the dirt on their own. Drones are your economy: every 5 drones is 1 action point (AP) per turn, which your soldier spends to walk and to lob arcing shots that blast craters. Kill the enemy queen to win.

**Play it: https://mitchellhillman.github.io/termites/**

![Termites mid-game: both colonies' tunnels, blast craters, the white soldier charging a shot, and the HUD](docs/screenshot.png)

## How to play

- A coin flip picks who goes first. Players alternate turns until a queen dies.
- At the start of your turn your queen spawns 5 drones (up to a cap of 50), then your AP is set to floor(drones / 5). Each side starts with 5 drones, so the first turn has 2 AP. Unused AP is lost.
- **Walk (1 AP):** unlocks 40px of movement (one grid cell). Soldiers climb any dirt, even vertical walls.
- **Shoot (1 AP):** aim along a 0–90° arc, press Fire to start the PWR bar, and press again to lock the power and fire. Shots fall under gravity (no wind) and explode on contact with dirt or any unit.
- **Steeper impact, bigger blast:** the blast radius grows from 5px for a flat hit to 100px for a straight-down hit. Harder dirt resists blasts; bedrock is indestructible.
- Every unit in a blast takes 1 hit, including your own. Drones and soldiers die in 1 hit; queens take 3 (shown as dots above them).
- If your soldier dies, your queen skips her next drone spawn and a new soldier appears the turn after.
- Your turn ends at 0 AP or when you press End Turn. Killing your own queen hands the win to the other player; if both queens die at once it's a draw.
- Press **Enter** on the win screen to play again on the same map.

### Controls

| Action | Player 1 (white) | Player 2 (red) |
|---|---|---|
| Walk (walk mode) / move aim (shoot mode) | A / D | ← / → |
| Flip facing | W / S | ↑ / ↓ |
| Toggle walk / shoot mode | Q | / |
| Fire (press to start the power bar, again to shoot) | E | . |
| End turn | R | , |

Any key starts the game from the title screen. Bindings live in `balance.json` under `controls` (as `KeyboardEvent.code` values).

## Run locally

There is no build step. Serve the repo root with any static server:

```sh
python3 -m http.server
```

Then open http://localhost:8000. Opening `index.html` directly (`file://`) doesn't work: browsers block ES module imports and `fetch()` of `balance.json` and `map.png` from `file://` URLs.

## Tweak it

- **`balance.json`** holds every tuning value: unit sizes and hit points, walk speed and budget, AP per drone, drone speed, cap and spawn counts, shot gravity and power, blast radii, timings, colors, HUD and title text, key bindings, and the terrain color key. Edit it and reload.
- **`map.png`** (640x480) is the level. Paint it in any image editor using exactly these colors (from `terrainKey` in `balance.json`); any other color loads as open space:

  | Color | Terrain | Blast resistance factor |
  |---|---|---|
  | `#2b1a0e` | Open (sky, tunnels) | empty |
  | `#9a6a3c` | Soft dirt | 1 |
  | `#845a32` | Medium dirt | 0.75 |
  | `#6e4a29` | Hard dirt | 0.5 |
  | `#4a4440` | Bedrock | undiggable, unblastable |

  Each queen is placed on the first floor found scanning down from `queen.spawnScanY` at her team's `queenX`, so keep a chamber there.
- **Regenerate assets** (Node, no dependencies, run from the repo root):
  - `node tools/generate-map.mjs` rebuilds `map.png` from the `mapGenerator` settings (seeded, so it's repeatable).
  - `node tools/generate-sprites.mjs` rebuilds the white-on-transparent sheets in `sprites/` from the ASCII art in the script. The game tints them to team colors at runtime.

  **Both overwrite their output, so hand edits to `map.png` or the sprite PNGs are lost.**
- **Debug:** set `debug.clickToExplode` to `true` to click (or click-drag) anywhere to blast the terrain. Change the radius with the mouse wheel or `[` / `]`.

## Project layout

```
index.html        page and canvas; loads src/main.js
balance.json      all tuning values, key bindings and the terrain color key
map.png           the level (terrain colors)
sprites/          sprite sheets: drone, soldier, queen, skull, cursor
src/
  main.js         startup, game loop, title / play / win flow
  terrain.js      map loading, destructible terrain, rendering
  units.js        soldiers, queens, drones (movement, digging, death)
  shots.js        aiming, power bar, ballistics, explosions
  turns.js        turn order, AP, drone spawns
  input.js        keyboard bindings and the debug click-to-explode tool
  hud.js          HUD, title and win screens, announcements
  sprites.js      sprite sheet loading and tinting
tools/            map and sprite generators (plus a tiny PNG encoder)
docs/             README screenshot
```

The full design spec is in [plan.md](plan.md).
