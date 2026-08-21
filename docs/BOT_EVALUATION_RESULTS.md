# Bot evaluation result — 2026-08-21

Command: `BOT_EVAL_SEEDS=100 npm run bot:evaluate`

The final deterministic run covered 400 full matches. Layout quotas differed by at most one: `LINE` 15, `H` 15, and `RING`, `GRAPH`, `CROSS`, `DIAMOND`, `COURTYARD` 14 each.

| Variant | Thief wins | Police wins | Thief behavior score | Police behavior score |
|---|---:|---:|---:|---:|
| rule thieves / rule police | 43 | 57 | 95.51 | -77.51 |
| greedy thieves / rule police | 35 | 65 | 96.285 | -71.78 |
| rule thieves / greedy police | 5 | 95 | 62.3275 | -41.27 |
| greedy thieves / greedy police | 11 | 89 | 63.2025 | -39.1775 |

Greedy thieves improved behavior score by only 0.81% and reduced thief win rate by eight percentage points, so they did not meet the 10% improvement gate. Rule-based thieves remain the default.

Against the same rule-based thieves, greedy police improved behavior score from `-77.51` to `-41.27` and police win rate from 57% to 95%. After adding one-second goal commitment and a four-point switch threshold, greedy police recorded 3.26% stuck time, zero target oscillations, 0.0017 ineffective actions per minute, and zero decision errors. Those operational gates pass, but the matchup violates the new 6:4 balance boundary: thief win rate is 5%, below 40%, and police win rate is 95%, above 60%. Greedy police are therefore retained for evaluation only, not selected as the production default.

The selected production policy is therefore:

```text
THIEF  = RULE_BASED
POLICE = RULE_BASED
```

An 84-bot embedded benchmark over 1,200 Room ticks recorded Room tick p95 `0.088 ms` and bot-decision p95 `0.029 ms`, below the 50 ms release threshold. A separate eight-bot WebSocket runner completed an integration match with zero protocol errors.
