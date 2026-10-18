# Termites vs. Ants — Game Plan

A simple 2D, turn-based, two-player artillery game played in a web browser on an HTML canvas. Transcribed from handwritten design notes, so it still needs review.

> Items marked **[?]** were hard to read or contradict another note. See **Open Questions** at the bottom.

---

## Overview

- 2D game screen
- 800x600 resolution
- 2 players: **"Termites" vs. "Ants"**
- Turn based
- Canvas web browser game
- Both players share the same keyboard
- Each player has a color: **Red / Black**
- When it's the Ants' or Termites' turn, the camera zooms into that side of the map
- The game has a grid overlay so players can easily judge distances

## Action Points (AP)

- Each team has a number of action points (AP)
- AP is determined by the number of drones
- **5 drones = 1 action point**
- Start with **10 drones (2 AP)**, so on your first turn you can shoot once and walk once
- AP tokens are shown in the game HUD

## Units

Each side has 3 unit types:

1. **Soldier**
2. **Drone**
3. **Queen**

General:
- Units have a pixel/block look
- Each unit is a single color (the player's color)
- When any unit dies, a tiny pixel skull sprite appears, then the skull and the unit sprite both disappear

### Queen
- Does not move
- Spawns 5 drones per turn
- Killing the Queen ends the game
- 3 hits to kill

### Soldier
- Can take actions that spend action points:
  1. Move (1 AP)
  2. Shoot (1 AP)
- Moves along the surface of the ground
- Moves **200px per AP**
- 1 hit to kill
- Killing a Soldier means that side's Queen stops spawning drones for one turn and spawns a new Soldier the next turn

### Drone
- Represented by a simple single-color pixel sprite
- Legs animate to suggest walking
- Always moving
- Move randomly, either along the surface or digging tunnels
- Move 20px per turn
- Can overlap each other
- The player cannot control drones directly
- 1 hit to kill
- Drone population determines AP (see above)

## Digging

- Drones "dig" by moving through the dirt in any direction
- A radius around each drone removes dirt as it walks
- Drones walk randomly in any direction through the earth
- They also walk along the surface of the dirt
- When on the surface, no dirt is removed
- Shots from Soldiers also "dig" (see Shooting)

## Shooting

### Controls
| Action | Player 1 | Player 2 |
|---|---|---|
| Movement / aim keys | WASD | Arrow keys |
| Adjust angle | Left / Right (A / D) | Left / Right (← / →) |
| Shoot | Space | Space **[?]** |
| Toggle walk / shoot mode | E | E **[?]** |

- ~~Up / Down for power~~ (crossed out, replaced by the power bar below)

### Power: "Quicktime" gradient bar
- A gradient bar with a "quicktime" selector picks the shot's power
- A bar appears with a white marker that moves up and down along a gradient (toward red); the player times the press to set power **[? from faint pencil notes]**
- Shown in the HUD as a vertical **PWR** bar near the active soldier

### Ballistics and explosion radius
- Power also affects the ballistic arc of the Soldier's shot
- **The angle of the drop sets the explosion radius:**
  - A high lob makes a big radius ("the more arched the shot, the more Boom!")
  - A straight shot makes a tiny radius. It's just as lethal to the target, but the blast is smaller
- The radius clears any dirt it lands on
- Any drone within the shot radius dies
- ~~The greater the shot power, the greater the radius of dirt cleared~~ (crossed out)
- The gun shoots a tiny **20px** hole in the ground/wall (1 AP)

### Damage
- Soldier: 1 hit to kill
- Drone: 1 hit to kill
- Queen: 3 hits to kill

## World / Terrain

- Side-view scene: sky on top, dirt below, with an uneven surface (hills and valleys)
- Each Queen sits at an opposite edge of the map; soldiers and drones start near their Queen
- **Random dirt layers** that resist digging and explosions by different amounts
- Over time, drones tunnel through the dirt toward the middle (sketch: "Drones break thru dirt")

## Art / Visual Style

- Pixel/block look
- Single-color sprites per unit, in the player's color (Red / Black)
- Sketches: drone (small, ant-like, side view), soldier (upright with a gun), queen (large, blocky, wide body)
- Guns: **Termites** use a revolver; **Ants** use a pistol
- Tiny pixel skull on death

## HUD

- Current turn indicator, e.g. "Ants Turn" (top right)
- AP tokens shown as circles, e.g. `AP ○○○` (bottom)
- PWR gradient bar shown while aiming
- Grid overlay

---

## Open Questions

1. **Shot radius: power or angle?** Page 2 says "shot power equals the radius," but page 1 crosses out the power-to-radius idea and says the drop angle sets the radius. The current plan uses **angle**. Please confirm.
2. **"5 AP per drone"** on page 1 looks like a slip for "5 drones per AP" (which page 2 and "10 drones = 2 AP" both support). Please confirm.
3. **Shared keys:** both players use the same keyboard. Do Space and E apply to both players? Since turns alternate, shared keys may be fine. Does P2 need different keys?
4. **"Queen makes 5 drones + 1 AP unless the [soldier?] died"**: the faint note reads "drone died"; it probably means soldier. Please confirm.
5. **Movement direction keys:** WASD/Arrows are assigned per player, and Left/Right adjust the angle. How does a soldier walk in walk mode? (Left/Right too, after toggling with E?)
6. **Drone speed:** is "20px per turn" per turn, or a continuous speed while they "are always moving"?
7. **Dirt layer resistance:** how many layer types are there, and how does resistance affect drone digging speed and blast radius?
8. **Camera:** how far does it zoom into each side, and should it pan to follow the shot?
9. **Win condition:** the game ends when a Queen dies. Is there anything else, such as a side running out of drones or AP?

## Next Steps

- [ ] Review the transcription and resolve the open questions
- [ ] Choose a tech approach (plain JS + canvas, no build step?)
- [ ] Prototype destructible terrain (pixel/bitmap dirt mask)
- [ ] Turn system and AP
- [ ] Soldier movement and shooting (arc, power bar, radius)
- [ ] Drone AI (random walk, digging)
- [ ] Queen spawning and death and win rules
- [ ] HUD, grid overlay, camera zoom
- [ ] Pixel sprites and death skull
