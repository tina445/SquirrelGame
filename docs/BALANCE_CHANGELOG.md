# Balance changelog

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
