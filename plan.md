# Termites — Game Plan

A simple 2D, turn-based, two-player artillery game played in a web browser on an HTML canvas. 

---

## Overview

- 2D game screen
- 640x480 resolution
- 2 players
- Turn based; a random coin flip picks who goes first, announced on screen
- Canvas web browser game
- Both players share the same keyboard
- Each player has a color: **White / Red**
- Environment has background of dark brown.
- Foreground and walkingsurface is medium brown representing dirt.
- The game has a grid overlay so players can easily judge distances

## Action Points (AP)

- Each team has a number of action points (AP)
- AP is determined by the number of drones
- **5 drones = 1 action point**
- Start with **5 drones**. The queen spawns 5 at the start of your first turn, giving 10 drones = 2 AP, so on your first turn you can shoot once and walk once
- AP tokens are shown in the game HUD
- drones are spawned from a queen, 5 each turn.

## Units

Each side has 3 unit types:

1. **Soldier**
2. **Drone**
3. **Queen**

General:
- Units have a pixel/block look
- Each unit is a single color (the player's color)
- When any unit dies, a tiny pixel skull sprite appears, then the skull and the unit sprite both disappear
- drones: 4X12 pixels horizontal
- soliders: 12x24 pixels vertical
- queen: 64x64 pixel

### Queen
- Does not move
- Spawns 5 drones per turn
- Killing the Queen ends the game
  - killing your own queen means the other player wins; if both queens die at once, the game is a draw
- 3 hits to kill
- health shown as 3 dots above the queen's head in the team color: filled = health remaining, hollow outline = hit taken

### Soldier
- Can take actions that spend action points:
  1. Move (1 AP)
  2. Shoot (1 AP)
- Moves along the surface of the ground
- Moves **40px per AP**
  - the grid matches the distance of the solider's movement
- 1 hit to kill
- Killing a Soldier means that side's Queen stops spawning drones for one turn and spawns a new Soldier the next turn

### Drone
- Represented by a simple single-color pixel sprite
- Legs animate to suggest walking
- Always moving
- Move randomly, either along the surface or digging tunnels
- Move 5px per second, continuously (set in balance.json)
- Can overlap each other
- The player cannot control drones directly
- 1 hit to kill
- Drone population determines AP (see above)

## Digging

- Drones "dig" by moving through the dirt in any direction
- their feet must always touch ground. 
- A radius around each drone removes dirt as it walks
- Drones walk randomly in any direction through the earth
- They also walk along the surface of the dirt
- When on the surface, no dirt is removed
- Shots from Soldiers also "dig" (see Shooting)

## Shooting

### Controls
| Action | Player 1 | Player 2 |
|---|---|---|
| Walk (walk mode) / move aim cursor (shoot mode) | A / D | ← / → |
| Flip facing | W / S | ↑ / ↓ |
| Toggle walk / shoot mode | Q | / |
| Fire (press to start power bar, press again to shoot) | E | . |
| End turn | R | , |

### Power: "Quicktime" gradient bar
- A gradient bar with a "quicktime" selector picks the shot's power
- A bar appears with a white marker that moves up and down along a gradient (toward red); the player times the press to set power.
- Shown in the HUD as a vertical **PWR** bar near the active soldier

### Ballistics and explosion radius
- Power also affects the ballistic arc of the Soldier's shot
- **The angle of the drop sets the explosion radius:**
  - A high lob makes a big radius ("the more arched the shot, the more Boom!")
  - A straight shot makes a tiny radius. It's just as lethal to the target, but the blast is smaller
- The radius clears any dirt it lands on
- Any unit within the shot radius takes 1 hit: drones and soldiers die, queens lose 1 of 3 HP
- the min radius of a shot is 5px
- the maximum radius is 100px

### Damage
- Soldier: 1 hit to kill
- Drone: 1 hit to kill
- Queen: 3 hits to kill

## World / Terrain

- Side-view scene: sky (or cleared tunnel) on top, dirt below, with an uneven surface (hills and valleys)
- Each queen starts in a pre-dug chamber underground near opposite edges of the map; drones spawn in the chamber. Each soldier starts on the surface above its queen
- A thin undiggable bedrock strip runs along the bottom of the map
- **Random dirt layers** that resist digging and explosions by different amounts
- Gravity: when dirt under a soldier or queen is removed, it falls until it lands (no fall damage). Drones cling to tunnel walls while touching dirt, and fall when nothing is touching them
- Over time, drones tunnel through the dirt toward the middle (sketch: "Drones break thru dirt")

## Art / Visual Style

- Pixel/block look
- Single-color sprites per unit, in the player's color (Red / White)
- Sketches: drone (small, ant-like, side view), soldier (upright with a gun), queen (large, blocky, wide body)
- Tiny pixel skull on death 

## HUD

- Current turn indicator, e.g. "Player 1 turn" (top right)
- AP tokens shown as circles, e.g. `AP ○○○` (bottom)
- PWR gradient bar shown while aiming
- Grid overlay

---

## Tech notes

- no sound in v1

- make all fixed pixel values set by a imported JSON with key value pairs, called balance.json so i can edit it by hand. 

## Open Questions

3. **Shared keys:** both players use the same keyboard. Do Space and E apply to both players? Since turns alternate, shared keys may be fine. Does P2 need different keys? 
  - no. each player has its own toggle and fire button
  - each player has its own direction keyts left and right sides of keyboard
7. **Dirt layer resistance:** how many layer types are there, and how does resistance affect drone digging speed and blast radius?
  - 3 layers of dirt
  - each has own shade of brown 
  - each resist digging by factor of 1, .75, .5
9. **Win condition:** the game ends when a Queen dies. Is there anything else, such as a side running out of drones or AP?
  - only win condition is queen dying. 

## Next Steps

- [x] Review the transcription and resolve the open questions
- [x] Choose a tech approach (plain JS + canvas, no build step?)
  - plain JS canvas. no build step. no frameworks
  - run locally with a static server (e.g. `python3 -m http.server`), and load balance.json with fetch()
  - hosted on GitHub Pages
  - split into a few ES modules: main.js, terrain.js, units.js, input.js, hud.js, plus balance.json
- [x] Prototype destructible terrain (pixel/bitmap dirt mask)
  - the map is a single 640x480 screen with no camera zoom or pan
  - hand-made map: `map.png` (640x480). I generate the first one, then it stays fixed and you can edit it by hand
  - a color key in balance.json maps each map color to whether it can be dug and how fast:
    - sky / open tunnel: empty
    - soft dirt: resistance 1
    - medium dirt: resistance .75
    - hard dirt: resistance .5
    - undiggable (e.g. bedrock): cannot be dug or blasted
  - the first generated map uses wavy horizontal bands (soft on top, hard on the bottom), random hills, and flat spots at each edge for the queens
  - explosions use resistance per pixel: a pixel is cleared only if its distance from the impact is less than radius × that layer's factor
  - at runtime the map is loaded into an offscreen canvas or typed array, and pixels are cleared in place
- [x] Turn system and AP
  - the turn ends automatically at 0 AP, or early when the player presses their End Turn key
  - at the start of a player's turn, their queen spawns 5 drones (unless their soldier died last turn), then AP = floor(drones / 5)
  - unused AP does not carry over
  - drones move continuously in real time during both players' turns (speed set in balance.json)
- [x] Soldier movement and shooting (arc, power bar, radius)
  - walking is free movement metered by AP: starting to walk spends 1 AP and unlocks 40px of travel; leftover distance is lost when you switch modes or end the turn
  - soldiers climb anything: they always follow the surface, including vertical walls
  - aim: a tiny cursor sprite moves in an arc around the soldier (left/right keys), from 0° (horizontal) to 90° (straight up) on the side the soldier faces; flip facing with W/S or ↑/↓
  - power: first fire press shows the PWR bar with the marker sweeping; second press locks the power and fires
  - projectile: gravity only, no wind (gravity set in balance.json)
  - shots explode on contact with dirt or any unit
  - friendly fire is on: blasts hurt your own units too
  - blast radius is linear in impact angle: flat (0°) = 5px, straight down (90°) = 100px
  - shots can arc above the top edge and fall back; shots past the left or right edge are lost
- [x] Drone AI (random walk, digging)
  - wander with a heading: each drone keeps a direction and turns slightly at random, which makes curvy tunnels
  - drones on the surface have a random chance to turn down and start a new tunnel
  - dig radius is slightly larger than the drone body (~8px, set in balance.json), so tunnels are drone-sized and too narrow for soldiers
  - dig speed is scaled by the resistance of the dirt the drone is in
  - drones turn around at undiggable pixels and screen edges
- [x] Queen spawning and death and win rules
  - drones spawn at the queen's base
  - drone cap per side is set in balance.json (e.g. 50 = 10 AP max)
  - each side always has exactly one soldier; when it dies, it respawns next to its queen on the turn after the spawn pause
  - when a queen dies, show "Player X wins", and a key restarts on the same map
- [x] HUD, grid overlay (camera zoom dropped: single-screen map)
  - grid: faint lines every 40px, always on
  - each player's AP is in their own bottom corner (P1 left, P2 right); the active player's is highlighted
  - HUD also shows: drone count per side, current mode (walk/shoot), walk budget remaining, and a controls hint for the active player
  - title screen: game name, controls for both players, "press any key"
- [x] Pixel sprites and death skull
  - PNG sprite sheets, drawn white on a transparent background and tinted to the team color at runtime
  - minimal frames: drone 2-frame leg walk; soldier idle + 2-frame walk; queen static; skull 1 frame; aim cursor 1 frame
  - explosion: an expanding blocky pixel ring that grows to the blast radius and fades, plus a few dirt-colored particles
  - the death skull shows for ~1s (set in balance.json), then the skull and the unit vanish together
