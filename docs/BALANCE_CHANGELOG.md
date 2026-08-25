# Balance changelog

## 2026-08-24 — 월드 축 이동 복원

- WASD와 방향키 이동을 조준 방향 회전에서 분리했다. `W/↑`는 항상 월드 북쪽, `S/↓`는 남쪽, `A/←`는 서쪽, `D/→`는 동쪽으로 이동한다.

## 2026-08-24 — 체포 접근성 완화와 구출·썬더 조정

- 경찰 체포 전용 권위 반경을 `1.8`에서 `1.6` unit으로 조정했다. 이는 기존 일반 상호작용 반경 `1.4`와 적극 체포 조정값 `1.8`의 중간값이며, 늘어난 썬더 기절 연계를 상쇄하도록 체포 hold는 `600ms`에서 `900ms`로 조정했고 추적 거리(`1.2`)는 유지한다.
- 썬더 기절은 `1.5s`에서 `2.1s`로 늘렸다. 명중 뒤 체포·탈취로 이어질 수 있는 협력 창을 보강하되, 사거리·명중 반경은 바꾸지 않는다.
- 전원 구출은 완료 시 현재 수감자 전원을 풀어 주므로, 구출 hold를 `3s`에서 `2.4s`로 줄였다. 구출 완료 뒤 체포 면역은 `3s`에서 `3.6s`로 늘려 즉시 재수감되는 경우를 막는다.

## 2026-08-24 — 전원 구출·운반 도토리 탈취와 봇 정지 입력

- 하나의 구출 hold가 끝나면 당시 수감된 도둑 전원을 서로 다른 탈출점으로 이동시키고, `3s` 체포 면역을 동일하게 부여한다. 구출 hold는 기존 `3s`를 유지한다.
- 운반 중인 경찰의 도토리는 `2.4` unit 안의 도둑이 탈취할 수 있다. 일반 도토리 상호작용(`1.4`)과 경찰 체포(`1.8`) 범위는 바꾸지 않는다.
- 봇 controller는 의도적인 정지 이동을 전방 이동으로 바꾸지 않는다. 미니맵 공개 베리·운반 도토리 정보를 사용하되, 썬더 탈취는 기절 시간 안에 탈취 범위까지 도달 가능한 거리에서만 시도한다.

## 2026-08-24 — 적극적 경찰 체포

- 경찰 체포 전용 권위 반경을 `1.4`가 아닌 `1.8` unit으로 분리했다. 도토리·구출 상호작용 반경은 `1.4`를 유지한다.
- rule-based 경찰은 일반 도둑 체포(`85`)를 바닥 도토리 회수(`80`)보다 우선한다. 체포 사거리 안에서는 Space를 누르고 `1.2` unit까지 계속 접근해 600ms 홀드를 유지한다.

## Generator 8 — team tactical alerts and distributed berries (balance version 5)

- `TEAM_NOTIFICATION` events reuse the authoritative game-event batch but are filtered by the server to the intended team before transmission. Police receive thief arrest, police-storage acorn theft, and jail escape alerts; thieves receive thief-base acorn secure alerts. The HUD renders these four results as yellow top-center toast text.
- Active berry cap increased from 2 to 5 and the deterministic spawn interval shortened from 15–25 seconds to 8–14 seconds so the larger cap becomes relevant during a match.
- Berry candidate centers increased from 32 to 40. Each map validator now requires every pair to be at least 14 units apart; runtime selection uses farthest-first centers and keeps active berry positions at least 12 units apart.
- Generator version increased from 7 to 8, fallback seed changed to `safe-meadow-v8`, balance version increased from 4 to 5, and protocol version increased from 6 to 7.

## Matchmaking bots — rule/greedy evaluation baseline

- Quick-match rooms begin adding one bot at 60 seconds and add one more every 10 seconds until the eight-player roster is complete. Friend rooms and rooms without an active human are never filled.
- Bot perception is limited to an 18-unit radius with static line of sight and a two-second last-seen memory. Decisions update after a seeded 200–450 ms delay; aim error is capped at four degrees.
- Rule-based and greedy strategies share the same collision-aware A* navigation, observation contract, and `InputCommand` adapter. The role-specific production default is selected only by the deterministic evaluation gate documented in `BOTS.md`.
- The 100-seed evaluation selected rule-based thieves and greedy police; the latter uses a one-second target commitment and four-point switch threshold to retain stronger policing without rapid target flicker.
- Bot behavior does not change player speed, interaction ranges, objective rewards, match duration, map generation, protocol version, or balance version.

## Generator 7 — tactical minimap and physical jail prefab (balance version 4)

- Added an always-visible client minimap derived only from the authoritative `MapDefinition` and `WorldSnapshot`. It shows terrain, bases A–C, thief base, jail, acorns, berries, teammates, and local facing; ordinary enemies remain hidden unless their carried acorn reveals the objective position.
- Increased player collision radius from 0.45 to 0.52 and interaction radius from 1.25 to 1.4. Presentation meshes for players, acorns, berries, thief base, storages, and jail also increased; obstacle AABBs and tree trunk/canopy sizes remain unchanged.
- Thief-base radius increased from 2.25 to 3.0, storage radius from 1.6 to 2.2, and jail radius from 1.8 to 2.6. The jail radius is now an impassable circular movement/hitscan/line-of-sight footprint shared by server and client prediction.
- Police no longer sample inside the jail. Four cardinal spawn disks of radius 3.5 are centered 7.27 units from the jail center, keeping each entire player spawn disk outside the jail footprint; thief spawn disks remain radius 4.5.
- Rescue range is measured from the jail prefab boundary rather than a jailed player's position. The rescue tooltip is anchored above the jail even with multiple prisoners.
- Generator version increased from 6 to 7, fallback seed changed to `safe-meadow-v7`, balance version increased from 3 to 4, and protocol version increased from 5 to 6.

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
