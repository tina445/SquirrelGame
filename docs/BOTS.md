# Bot architecture and evaluation

## Runtime boundary

`@squirrel-heist/bot-core` contains no Node, WebSocket, or `MatchRoom` dependency. A `BotPolicy` receives a filtered `BotObservation` and returns world-space movement, aim, and action intent. `BotController` converts that intent into ordered `InputCommand` packets with the same button-edge semantics used by a browser client.

Production quick-match filling uses `RoomBotCoordinator` in the server process. It adds one ready `RANDOM` bot at 60 seconds and then one every 10 seconds, provided the room is a `QUICK_MATCH` lobby with at least one connected human. The coordinator can only enqueue inputs; authoritative movement, collision, acorns, arrest, rescue, thunder, and results remain in `MatchRoom`.

`MATCH_BOTS_ENABLED=false` disables production filling. `MATCH_BOT_FILL_DELAY_MS` and `MATCH_BOT_FILL_INTERVAL_MS` provide non-negative test/development overrides; production defaults remain 60,000 and 10,000 ms.

`npm run bot:run` starts the transport adapter in `tools`. `BOT_COUNT`, `BOT_POLICY`, `BOT_WS_URL`, and `BOT_DURATION_MS` configure a separate WebSocket process using the same controller. This is the load/integration path and the extraction seam for a future independently deployed bot service; trusted service authentication and provisioning are deliberately not part of the current runtime.

## Human-like constraints

- Static map knowledge is global, but opponents and dynamic resources require an 18-unit radius and unobstructed line of sight.
- Opponent sightings are remembered for two seconds. Bot teammates do not share hidden opponent memory.
- Strategic decisions update every seeded 200–450 ms, aim error is at most four degrees, and navigation intent receives a small seeded deviation.
- Collision-aware grid A* uses the same playable polygon, holes, AABBs, tree trunks, jail footprint, and player radius as the authoritative simulation.
- Rule-based thieves evade nearby police, secure carried acorns, rescue prisoners, and then seek acorns. Rule-based police return carried acorns, arrest visible thieves, recover ground acorns, and patrol objectives.
- Greedy policies score the same candidate goals using objective value, travel cost, visible danger, and teammate duplication. A one-second commitment and four-point switch threshold prevent small utility changes from causing target flicker.

## Deterministic evaluation

Run `npm run bot:evaluate`. `BOT_EVAL_SEEDS` defaults to 100. The runner balances the seven map layout families and executes rule/rule, greedy-thief, greedy-police, and greedy/greedy variants for each seed. Player IDs, policy seeds, map seeds, perception, and reaction delays are deterministic.

Thief rewards are storage pickup `+10`, secure `+40`, rescue `+15`, each 15 seconds unjailed `+1`, and thunder hit `+4`. Police rewards are arrest `+30`, ground pickup `+8`, storage return `+20`, and thunder hit `+4`. Penalties cover arrest, theft/secure/rescue allowed, invalid drops, stun, thunder miss, and abandoned interactions. Win rate is reported separately.

Greedy becomes the default for a role only when it improves that role's average behavior score by at least 10%, loses no more than three percentage points of win rate, spends under 5% of play time stuck, produces at most six ineffective actions per minute, has no rapid target oscillation, and raises no decision error. The candidate matchup must also keep both role win rates within the 40–60% (6:4) boundary. Otherwise that role remains rule-based. The committed default must match the latest recorded full evaluation result rather than changing itself at runtime.

The latest committed result is documented in `BOT_EVALUATION_RESULTS.md`: both thief and police bots use `RULE_BASED`.

Room metrics expose current and cumulative bots plus average/p95 decision time and decision errors. A release candidate must retain a Room tick p95 below 50 ms under the 80-bot load scenario.
