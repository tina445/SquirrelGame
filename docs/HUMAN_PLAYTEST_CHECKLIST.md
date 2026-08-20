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
- Verify WebSocket access through the final `ws://` or `wss://` endpoint and the actual reverse proxy.
- Verify audio permission, WebGL availability, keyboard/mouse input, and that reconnect/full resync works once.
- Verify on screen that `W`/Up moves up, `S`/Down moves down, `A`/Left moves left, and `D`/Right moves right. Confirm `D` no longer toggles collision debug and the backtick key does.
- Move the pointer around a stationary player and while holding movement keys; the local character should face the pointer without waiting for a server snapshot.
- Pick up a berry, aim in a direction different from the character's previous facing, and click once. Confirm the projectile leaves in the current cursor direction and the server-authoritative hit/wall result matches it.
- Keep the tested commit SHA, map seed, browser versions, operating systems, and failed dependency output with the playtest notes.

If any required browser fails to launch or the WebKit CI check is missing/stale, postpone the human session or explicitly narrow its supported-browser scope before starting.
