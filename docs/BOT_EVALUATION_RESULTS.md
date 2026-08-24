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

## 2026-08-24 — arrest-range comparison

The same 100 fixed seeds (400 matches; `LINE`/`H` 15 each and the other five layouts 14 each) were run before and after the police-arrest adjustment. The baseline used the former `1.4`-unit arrest range, normal-thief score `75`, and no close-in follow rule. The adjusted run used `arrestRadius=1.8`, score `85`, and follow-through to `1.2` units.

| Variant | Baseline thief / police wins | Adjusted thief / police wins | Change |
|---|---:|---:|---:|
| rule thieves / rule police | 44 / 56 | 35 / 65 | police +9%p |
| greedy thieves / rule police | 30 / 70 | 20 / 80 | police +10%p |
| rule thieves / greedy police | 4 / 96 | 3 / 97 | police +1%p |
| greedy thieves / greedy police | 12 / 88 | 6 / 94 | police +6%p |

All runs had zero decision errors; the rule/rule adjusted run remained below the quality thresholds (thief/police stuck time 3.75%/2.48%, ineffective actions per minute 0.0010/0.0041, and police oscillation 0.03 per match). However, its 65:35 result exceeds the 6:4 fairness boundary. The adjusted arrest behavior is therefore not a production-default balance candidate until its parameters are retuned and re-evaluated.

## 2026-08-24 — thief tactical recovery with arrest retained

After retaining the `1.8`-unit police arrest range, the bot controller was corrected to preserve a zero movement decision. Previously its aim-jitter fallback converted a deliberate stop into forward movement, which repeatedly broke interaction holds. The thief policy also consumes minimap-public berry and carried-acorn markers, assigns one resource scout, uses thunder only when it can reach a stunned carrier in time, and has an extended `2.4`-unit carried-acorn steal range. A completed rescue releases every currently jailed thief and grants three seconds of arrest immunity.

The fixed 100-seed/400-match evaluation produced rule/rule **45 thief wins / 55 police wins**, within the 6:4 boundary. Rule thieves averaged 7.35 secured acorns, 3.46 berries, 2.51 thunder shots, 2.09 thunder hits, 0.28 carried-acorn steals, and 4.95 rescue completions per match. Thief stuck time was 2.56%, ineffective inputs 0.0008/minute, and decision errors zero. Rule-based remains the production policy for both roles; greedy thief and police variants remain outside the balance boundary.

## 2026-08-24 — 2.1초 썬더와 완화된 체포 범위

The final deterministic run retained rule-based production bots and covered the same 100 fixed seeds and 400 matches. Balance values were `arrestRadius=1.6`, `arrestHoldMs=900`, `thunderStunMs=2_100`, `rescueHoldMs=2_400`, and `rescueArrestImmunityMs=3_600`.

| Variant | Thief wins | Police wins | Thief behavior score | Police behavior score |
|---|---:|---:|---:|---:|
| rule thieves / rule police | 41 | 59 | 94.6825 | -59.2875 |
| greedy thieves / rule police | 37 | 63 | 87.1925 | -54.7725 |
| rule thieves / greedy police | 7 | 93 | 30.4175 | -5.1525 |
| greedy thieves / greedy police | 15 | 85 | 41.5 | -14.9875 |

The rule/rule matchup is inside the 40–60% boundary. It averaged 5.55 arrests, 3.94 all-prisoner rescues, 2.63 thunder shots, 2.24 thunder hits, and 0.18 carried-acorn steals per match. Stuck time was 2.67% for thieves and 1.65% for police, ineffective actions were 0 and 0.0086/minute, and decision errors were zero. The longer stun makes every visible carrier inside the 15-unit thunder range reachable for a follow-up steal; the bot boundary test records that intended behavior. Greedy variants remain unselected because their matchup win rates are outside the balance boundary.
