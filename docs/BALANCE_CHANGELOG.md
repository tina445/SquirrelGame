# Balance changelog

## Generator 6 — four-times linear world and thinner tree trunks (balance version 3)

- World dimensions increased from 64 × 48 to 256 × 192: four times on each axis and sixteen times in area. Playable polygons, holes, thief base, police storages, jail, spawn anchors, and route metadata scale with the macro world.
- Obstacles deliberately do not scale uniformly with the world: long axes use 2.4× and short axes 1.35×, preserving useful corridors instead of creating four-times-thick walls.
- Deterministic tree count increased from 7 to 28 and berry spawn centers from 12 to 32 across the larger bounds. Tree trunk radii decreased from 0.68–0.90 to 0.46–0.64 while non-colliding canopy radii remain 2.05–2.65.
- Player spawn disks increased from 2.2 to 4.5 units and berry spawn disks from 1.25 to 2.5 units. Runtime spawn sampling and map validation share the same full-disk safety rules.
- Generator version increased from 5 to 6, fallback seed changed to `safe-meadow-v6`, balance version increased from 2 to 3, and protocol version increased from 4 to 5.

## Generator 5 — expanded terrain, spawn, and hitscan (balance version unchanged)

- Added deterministic `CROSS`, `DIAMOND`, and `COURTYARD` terrain to the existing `LINE`, `H`, `RING`, and `GRAPH` set. Police storages are spread farther apart and courtyard layouts use two holes.
- Player spawn disks increased from 0.6 to 2.2 units. Thieves sample around the thief base and police sample around the jail, avoiding blockers and one another.
- W/S now moves forward/back along facing while A/D strafes. Local presentation integrates current input every render frame and applies reconciliation error gradually; remote actors retain buffered interpolation.
- Thunder changed from a moving projectile to a 15-unit server-authoritative hitscan with a 0.16-unit hit radius and a 180 ms beam effect. Stun remains 1.5 seconds.
- Generator version increased from 4 to 5; fallback seed changed to `safe-meadow-v5`. Protocol version increased from 3 to 4. Balance version remains 2.

## Generator 4 — topology and cover (balance version unchanged)

- Deterministic `LINE`, `H`, `RING`, and `GRAPH` layouts share the 64 × 48 outer budget; ring layouts add a non-playable central hole.
- Every validated map includes circular tree trunks and larger non-colliding canopies. A client's own canopy fades while its local player overlaps the canopy.
- Player spawn positions are sampled within 0.6-unit circles around team spawn points. Berry positions are sampled within 1.25-unit circles around berry spawn points; the full circles are validated against boundaries and blockers.
- The authoritative simulation and snapshots remain 20 Hz. Remote presentation advances an estimated server clock each render frame, buffers 100 ms, and caps velocity extrapolation at 100 ms.
- Generator version increased from 3 to 4; fallback seed changed to `safe-meadow-v4`. Balance version remains 2.

## Generator 3 — irregular playable area (balance version unchanged)

- The 64 × 48 outer budget and movement/balance values remain unchanged.
- Each seed now produces an eight-vertex playable polygon, varied anchors, and more diverse horizontal/vertical obstacle clusters.
- Server collision, client prediction, projectile boundaries, rendering, hashing, and validation share the same polygon.
- Generator version increased from 2 to 3; fallback seed changed to `safe-meadow-v3`. Balance version remains 2.

## 0.2.0 — four-times map area

- World: 64 × 48 units, four times the previous area.
- Anchor layout distances are doubled while player speed, collision radius, interaction ranges, and objective-zone radii remain unchanged.
- Expected travel times between objectives are therefore approximately doubled.
- Generator and balance versions increased from 1 to 2; fallback seed changed to `safe-meadow-v2`.
- Camera up-vector now maps world `+Y` to screen-up, so W/S and mouse aiming share the same orientation.

## 0.1.0 — initial gray-box values

- World: 32 × 24 units; player speed 7 units/s; radius 0.45.
- Interaction radius: 1.25; berry pickup radius: 0.75.
- Thunder: 18 units/s, 15-unit range, 0.16 radius.
- Snapshot rate: 20 Hz; interpolation delay: 100 ms.
- Reconnect grace period: 10 seconds; entity stays stationary, then a carried acorn drops.

These provisional values satisfy the specification's data-first requirement. Record playtest measurements and reasons here before changing them.
