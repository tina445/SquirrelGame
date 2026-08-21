# Human playtest preflight

Run this checklist again immediately before every human playtest session. Do not rely only on an earlier CI result.

## Required automated checks

1. Run `npm ci` on the playtest build or deployment revision.
2. Run `npm run playtest:preflight` on the machine that will host or operate the session.
3. Run `npm test`, `npm run lint`, and `npm run build` on the exact revision.
4. Confirm the latest **WebKit E2E** GitHub Actions run for the exact commit is green.
5. If the playtest host is an officially supported Debian/Ubuntu environment, additionally run `npm run playtest:preflight -- --require-webkit`.

On unsupported rolling distributions such as Arch Linux, a local WebKit result of `CI_REQUIRED` is expected. Chromium and Firefox must still report `PASS`; WebKit is accepted only when the matching GitHub Actions commit is green.

## Session dependency checks

- Open `/health` and verify the server reports `ok: true`.
- Open `/metrics` and verify Room tick p95 remains well below 50 ms.
- Join once from every browser family intended for the session before inviting players.
- Exercise quick match once, then create a private Room and join it from a second browser with the lowercase form of its code. Confirm the private Room was not selected by quick match.
- Confirm quick match flows `match button → police/thief/random → waiting`. In a friend Room confirm `join → 4×2 waiting room → police/thief → ready`, roles remain unassigned until all 8 players are ready, then resolve to exactly 4 thieves/4 police.
- Return to main from a waiting quick/friend Room and confirm the slot disappears immediately; when the last player leaves, confirm `/health` no longer counts the Room.
- Disconnect one lobby player past the grace period and confirm a replacement can reclaim the slot. Reload one active player and confirm movement resumes without waiting for old input sequence numbers.
- Verify WebSocket access through the final `ws://` or `wss://` endpoint and the actual reverse proxy.
- Verify audio permission, WebGL availability, keyboard/mouse input, and that reconnect/full resync works once.
- Rotate the cursor around the player and verify `W/S` always moves forward/back along facing while `A/D` strafes. Confirm `D` no longer toggles collision debug and the backtick key does.
- Move the pointer around a stationary player and while holding movement keys; the local character should face the pointer without waiting for a server snapshot.
- Pick up a berry, aim in a direction different from the character's previous facing, and click once. Confirm the beam appears immediately, stops at the first wall/tree/enemy, and the hit target receives orbiting stun stars.
- Observe both the local and a remote player at 60fps while moving and stopping; confirm neither 20Hz input application nor snapshots produce visible stepping and reconciliation does not drift.
- Traverse all `LINE`, `H`, `RING`, `GRAPH`, `CROSS`, `DIAMOND`, and `COURTYARD` layouts. Confirm police spawn around the jail and the three police storages are broadly distributed.
- Enter a tree canopy and confirm only that local client's canopy fades. On another client both the canopy and squirrel must remain fully opaque; the trunk must still block movement and hitscan.
- Approach the thief base, each police storage, jail, a usable acorn, a jailed teammate, and an arrestable thief. Confirm the corresponding world tooltip appears over the target and disappears out of trigger range.
- Keep the tested commit SHA, map seed, browser versions, operating systems, and failed dependency output with the playtest notes.

If any required browser fails to launch or the WebKit CI check is missing/stale, postpone the human session or explicitly narrow its supported-browser scope before starting.
