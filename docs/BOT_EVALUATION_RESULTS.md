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

## 2026-08-26 — 소폭 기절·체포 상향 재평가

`thunderStunMs`를 `2,100ms`에서 `2,250ms`로, `arrestRadius`를 `1.70`에서 `1.75`로 조정했다. 구출 유지 시간은 `2,400ms`로 유지했다. `BOT_EVAL_SEEDS=100 npm run bot:evaluate`(400경기)에서 rule/rule은 **도둑 51승 / 경찰 49승**으로 6:4 경계 안에 남았다. 평균 썬더 발사/명중은 `2.46 / 1.65`, 체포 `6.47`, 전원 구출 `4.32`회였다.

도둑/경찰의 막힘 비율은 각각 `1.12% / 2.45%`, 판단 오류는 모두 0건이었다. 따라서 두 수치를 운영 기본값으로 채택하고, 구출 시간 단축은 적용하지 않았다.

## 2026-08-26 — 명중 후속·유휴 대체·경계 회피 통합

자신의 람쥐썬더 명중을 기절 시간 동안 기억해 기존 `arrest:`/`steal-carried:` 목표를 제한적으로 우선하고, 도둑에게만 주 목표가 완전히 없을 때 낮은 우선순위 정찰 목표를 부여했다. 무도토리 도둑의 도주는 불규칙 playable polygon·hole·장애물을 포함한 navigation grid에서 6-hop 이내의 실제 도달 가능한 첫 칸을 선택한다.

동일한 100시드/400경기 평가에서 rule/rule은 **도둑 48승 / 경찰 52승**이었다. 도둑 유휴 비율은 `0.14%`, 경계 인접 체포 비율은 `6.54%`, 썬더 명중 뒤 의미 있는 후속 목표 전환은 도둑 `80.0%`, 경찰 `32.0%`였다. 평균 썬더 발사/명중은 `4.86 / 3.14`회였다. 막힘 비율은 도둑/경찰 `0.58% / 0.33%`, 판단 오류는 0건으로 모든 운영 품질 게이트를 통과했다. 생산 기본값은 계속 양 팀 rule-based다.

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

## 2026-08-24 — 기지 우선 운반 도둑과 경찰 차단

With an acorn-carrying thief navigating to its base, the old rule/rule matchup became thief-favored (`71/29`). Rule police were then changed to navigate toward a short interception point on the carrier's route to the thief base, while retaining actual-position validation for arrest input. The same deterministic 100-seed/400-match run produced the following result.

| Variant | Thief wins | Police wins | Thief behavior score | Police behavior score |
|---|---:|---:|---:|---:|
| rule thieves / rule police | 53 | 47 | 97.91 | -69.8225 |
| greedy thieves / rule police | 58 | 42 | 87.48 | -61.995 |
| rule thieves / greedy police | 18 | 82 | 35.07 | -16.775 |
| greedy thieves / greedy police | 24 | 76 | 42.35 | -23.0425 |

Rule/rule is within the 40–60% boundary. It averaged 5.04 arrests and 7.95 secured acorns; stuck ratios were 2.90%/1.37%, ineffective actions 0.0005/0.0018 per minute, and decision errors zero. Greedy thieves did not improve their behavior score by 10%, while greedy police and greedy/greedy exceeded the police win-rate boundary, so rule-based remains the production selection.

A one-second rule-goal commitment was also evaluated to eliminate goal oscillation. It reduced oscillations to zero but produced `61/39`, worse than the retained `53/47` balance; it was not adopted.

## 2026-08-25 — 축소 맵·차지형 썬더 재평가

맵을 `192 × 144`(기존 선형 크기의 75%)로 축소하고, 체포 반경을 `1.7`로 조정했다. 베리는 최대 6개, 6~10초 간격으로 늘렸으며 람쥐썬더는 1초 정지 차지 후 최신 조준 방향으로 발사하도록 바꿨다. 기절 시간은 2.1초, 전원 구출 유지 시간은 2.4초다.

Greedy는 역할별 최우선 목표를 먼저 고정한 뒤, 동률 목표의 이동 비용만 비교하도록 조정했다. 이로써 팀 중복 페널티가 다수 경찰의 포위를 과도하게 최적화하던 문제를 제거했다.

`BOT_EVAL_SEEDS=100 npm run bot:evaluate` 결과(7개 레이아웃, 400경기):

| Variant | Thief wins | Police wins |
|---|---:|---:|
| rule thieves / rule police | 52 | 48 |
| greedy thieves / rule police | 54 | 46 |
| rule thieves / greedy police | 43 | 57 |
| greedy thieves / greedy police | 40 | 60 |

모든 조합이 40–60% 경계에 있고, 막힘 비율은 최대 1.28%, 무효 입력은 분당 최대 0.0044회, 판단 오류는 0건이었다. 운영 기본값은 기존처럼 양 팀 `RULE_BASED`를 유지한다.
