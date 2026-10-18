# Termites — Game Plan

A simple 2D, turn-based, two-player artillery game played in a web browser on an HTML canvas.

---

## Overview

- 2D side-view game on a single 640x480 screen with no camera zoom or pan
- 2 players share one keyboard and take turns
- A random coin flip picks who goes first and is announced on screen
- Player colors: **Player 1 is White, Player 2 is Red**
- Open space (sky and cleared tunnels) is dark brown; dirt is shades of medium brown
- A faint grid overlay every 40px is always on, so players can judge distances
- There is no sound in v1

## Game Flow

1. A title screen shows the game name and both players' controls; any key starts the game.
2. Players alternate turns until a queen dies.
3. A win screen shows "Player X wins" (or "Draw"); a key restarts on the same map.

## Turns and Action Points (AP)

- At the start of a player's turn:
  1. Their queen spawns 5 drones, unless their soldier died during the previous turn.
  2. Their AP is set to floor(drones / 5).
- **5 drones = 1 AP**
- Each side starts with 5 drones. The first spawn brings that to 10 drones, so each player has 2 AP on their first turn (enough to walk once and shoot once).
- Each side has a drone cap set in balance.json (default 50 = 10 AP max).
- Unused AP does not carry over.
- The turn ends automatically at 0 AP, or early when the player presses their End Turn key.
- Drones move continuously in real time during both players' turns.

## Win Conditions

- The game ends when a queen dies.
- Killing your own queen means the other player wins.
- If both queens die at once, the game is a draw.

## Units

Each side has a **Queen**, one **Soldier**, and many **Drones**. Every unit is a single-color pixel sprite in its team's color.

| Unit | Size | Hits to kill |
|---|---|---|
| Drone | 12x4 px (horizontal) | 1 |
| Soldier | 12x24 px (vertical) | 1 |
| Queen | 64x64 px | 3 |

When any unit dies, a tiny pixel skull appears over it for ~1s (set in balance.json), then the skull and the unit vanish together.

### Queen

- Starts in a pre-dug chamber underground, near its edge of the map
- Never moves on its own, but falls if the dirt under it is removed
- Spawns 5 drones per turn at its base
- Shows its health as 3 dots above its head in the team color: filled dots are health remaining, hollow outlines are hits taken

### Soldier

- Each side always has exactly one soldier, which starts on the surface above its queen
- Spends AP on two actions:
  - **Walk (1 AP):** starting to walk spends 1 AP and unlocks 40px of free movement (one grid cell). Leftover distance is lost when the player switches modes or ends the turn.
  - **Shoot (1 AP):** see Shooting
- Walks along whatever dirt surface it stands on and climbs anything, including vertical walls
- When a soldier dies, its queen skips its next drone spawn, and a new soldier appears on the surface above the queen on the turn after that

### Drone

- The player cannot control drones
- Drones are always moving at 5px per second (set in balance.json)
- Their legs animate to suggest walking
- Drones can overlap each other
- Drones wander: each keeps a heading and turns slightly at random, which makes curvy tunnels
- Drones turn around at undiggable dirt and at screen edges
- Drone population determines AP

## Digging

- Drones dig by moving through dirt in any direction. A radius slightly larger than the drone's body (~8px, set in balance.json) clears dirt as it moves.
- Drone tunnels are drone-sized and too narrow for soldiers.
- Dig speed is scaled by the resistance of the dirt the drone is in.
- A drone's feet always touch dirt. Drones cling to tunnel walls, and fall when nothing is touching them.
- Drones also walk along the surface, where they clear no dirt. Surface drones have a random chance to turn downward and start a new tunnel.
- Over time, drones tunnel through the dirt toward the middle of the map.
- Soldier shots also dig (see Shooting).

## Shooting

### Controls

| Action | Player 1 | Player 2 |
|---|---|---|
| Walk (walk mode) / move aim cursor (shoot mode) | A / D | ← / → |
| Flip facing | W / S | ↑ / ↓ |
| Toggle walk / shoot mode | Q | / |
| Fire (press to start power bar, press again to shoot) | E | . |
| End turn | R | , |

### Aiming

- A tiny cursor sprite moves along an arc around the soldier, from 0° (horizontal) to 90° (straight up), on the side the soldier faces.

### Power: "Quicktime" bar

- The first Fire press shows a vertical **PWR** gradient bar next to the active soldier. A white marker sweeps up and down along it, toward red.
- The second Fire press locks the power and fires.
- Power sets the launch speed and therefore the arc.

### Ballistics

- Shots are affected by gravity only, with no wind (gravity set in balance.json).
- Shots explode on contact with dirt or any unit.
- Shots can arc above the top edge and fall back down. Shots that leave the left or right edge are lost.

### Explosions

- **The impact angle sets the blast radius:** it scales linearly from 5px for a flat impact (0°) to 100px for a straight-down impact (90°). The more arched the shot, the bigger the boom.
- A straight shot is just as lethal to what it hits, but its blast is smaller.
- Every unit inside the radius takes 1 hit, including your own (friendly fire is on). Drones and soldiers die, and queens lose 1 of 3 health.
- The blast clears dirt, reduced by resistance: a dirt pixel is cleared only if its distance from the impact is less than radius × that dirt's resistance factor.
- The explosion appears as a blocky pixel ring that grows to the blast radius and fades, plus a few dirt-colored particles.

## World / Terrain

- The map is a hand-editable `map.png` (640x480). The first map is generated, then stays fixed.
- A color key in balance.json maps each map color to its terrain type:

| Terrain | Resistance factor |
|---|---|
| Open (sky / tunnel) | empty |
| Soft dirt | 1 |
| Medium dirt | 0.75 |
| Hard dirt | 0.5 |
| Bedrock | undiggable and unblastable |

- The generated map has an uneven surface with hills and valleys, and wavy horizontal dirt bands (soft on top, hard at the bottom). Each dirt type has its own shade of brown.
- Each queen has a pre-dug chamber near its edge of the map.
- A thin bedrock strip runs along the bottom of the map.
- Gravity: when the dirt under a soldier or queen is removed, it falls until it lands. There is no fall damage.

## Art / Visual Style

- Pixel/block style
- Sprites are PNG sprite sheets drawn white on a transparent background, and tinted to the team color at runtime
- Frames: drone has a 2-frame leg walk; soldier has an idle frame and a 2-frame walk; queen, skull, and aim cursor are 1 frame each
- Reference sketches: drone (small, ant-like, side view), soldier (upright with a gun), queen (large, blocky, wide body)

## HUD

- Current turn indicator, e.g. "Player 1 turn" (top right)
- Each player's AP tokens, shown as circles like `AP ○○○`, in their own bottom corner (P1 left, P2 right). The active player's AP is highlighted.
- Drone count for each side
- The active soldier's current mode (walk or shoot)
- Remaining walk budget
- A controls hint for the active player
- The PWR bar while aiming

## Tech

- Plain JavaScript and HTML canvas, with no build step and no frameworks
- Code is split into a few ES modules: `main.js`, `terrain.js`, `units.js`, `input.js`, `hud.js`
- All tunable values (sizes, speeds, radii, counts, timings, colors, the terrain color key) live in a hand-editable `balance.json`, loaded with `fetch()`
- At runtime, `map.png` is loaded into an offscreen canvas or typed array, and dirt is cleared in place
- Run locally with a static server (e.g. `python3 -m http.server`)
- Hosted on GitHub Pages

## Implementation Roadmap

Each slice ends with something you can run and see in the browser.

- [x] **1. Skeleton and terrain:** `index.html`, the module layout, `balance.json` loading, and generating the first `map.png`. Draw the map with its color key and the grid overlay.
- [x] **2. Destructible terrain:** clicking the map makes a test explosion that clears dirt, with smaller craters in harder dirt and none in bedrock.
- [ ] **3. One soldier walking:** soldier sprite, gravity and falling, walking on surfaces and climbing walls, and the 40px walk budget. P1 keys only.
- [ ] **4. Shooting:** aim cursor, facing flip, PWR bar, shot arc, explosion on contact, blast radius from impact angle, and the pixel-ring effect.
- [ ] **5. Two players and turns:** second soldier, P2 keys, mode toggle, AP spending, End Turn, coin flip, and turn indicator. Uses a fixed AP number until drones exist.
- [ ] **6. Queens and win rules:** queens in their chambers, 3 health and health dots, blast damage to all units, friendly fire, and win, draw, and restart.
- [ ] **7. Drones:** spawning, the drone cap, wandering, tunneling with resistance, wall-clinging, and real-time movement. AP comes from drone count; soldier death skips a spawn and respawns the soldier.
- [ ] **8. Polish:** PNG sprite sheets with tinting, walk animations, death skulls, explosion particles, the full HUD, and the title screen.
- [ ] **9. Ship:** GitHub Pages setup and a README with how to run and play.
