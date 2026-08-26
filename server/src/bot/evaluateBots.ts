import { availableParallelism } from 'node:os';
import { fork } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { generateMap } from '@squirrel-heist/shared';
import {
  mergeBotEvaluationResults, selectEvaluationSeeds,
  type BotEvaluationResult, type BotEvaluationSeedSet
} from './evaluation.js';

export interface BotEvaluationStage {
  seeds: number;
  passed: boolean;
  failedReasons: string[];
  result: BotEvaluationResult;
}

export interface StagedBotEvaluationResult {
  workers: number;
  stages: BotEvaluationStage[];
  final: BotEvaluationResult | null;
}

function countLayouts(seeds: string[]): Record<string, number> {
  const layouts: Record<string, number> = {};
  for (const seed of seeds) {
    const kind = generateMap(seed).map.layoutKind;
    layouts[kind] = (layouts[kind] ?? 0) + 1;
  }
  return layouts;
}

/** 100 seed 후보를 layout별로 교차 배치해 14·35 seed 접두부도 균등하게 유지한다. */
export function selectStagedSeeds(seedCount = 100): BotEvaluationSeedSet {
  const source = selectEvaluationSeeds(seedCount);
  const byLayout = new Map<string, string[]>();
  for (const seed of source.seeds) {
    const kind = generateMap(seed).map.layoutKind;
    byLayout.set(kind, [...(byLayout.get(kind) ?? []), seed]);
  }
  const ordered: string[] = [];
  const kinds = [...byLayout.keys()].sort();
  for (let offset = 0; ordered.length < source.seeds.length; offset += 1) {
    for (const kind of kinds) {
      const seed = byLayout.get(kind)?.[offset];
      if (seed) ordered.push(seed);
    }
  }
  return { seeds: ordered, layouts: countLayouts(ordered) };
}

function configuredWorkers(seedCount: number): number {
  const supplied = Number(process.env.BOT_EVAL_WORKERS);
  // 이 시뮬레이션은 맵·경로 캐시를 각 프로세스에 독립 보유하므로, 메모리가 작은 개발 환경의 기본값은 2개로 둔다.
  const cpuBound = Number.isInteger(supplied) && supplied > 0 ? supplied : Math.min(2, availableParallelism());
  return Math.max(1, Math.min(cpuBound, seedCount));
}

/** 한 워커는 독립 시뮬레이션만 실행하며, 최종 수치의 합산 순서는 부모가 고정한다. */
function runWorker(seedSet: BotEvaluationSeedSet): Promise<BotEvaluationResult> {
  return new Promise((resolve, reject) => {
    const worker = fork(new URL('./evaluateBotsWorker.js', import.meta.url), [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let settled = false;
    worker.once('message', (message: { result?: BotEvaluationResult; error?: string }) => {
      settled = true;
      if (message.error) reject(new Error(message.error));
      else if (message.result) resolve(message.result);
      else reject(new Error('봇 평가 워커가 결과 없이 종료되었습니다.'));
    });
    worker.once('error', reject);
    worker.once('exit', (code) => { if (!settled && code !== 0) reject(new Error(`봇 평가 워커가 종료되었습니다: ${code}`)); });
    worker.send({ seedSet });
  });
}

export async function evaluateSeedSetInWorkers(seedSet: BotEvaluationSeedSet, workerCount = configuredWorkers(seedSet.seeds.length)): Promise<BotEvaluationResult> {
  const perSeed = seedSet.seeds.map((seed) => ({ seeds: [seed], layouts: countLayouts([seed]) }));
  const results: BotEvaluationResult[] = new Array(perSeed.length);
  let nextIndex = 0;
  // 장기 실행한 워커가 navigation cache를 누적하지 않도록 seed 하나를 끝내면 프로세스를 교체한다.
  const runNext = async (): Promise<void> => {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= perSeed.length) return;
    results[index] = await runWorker(perSeed[index]!);
    await runNext();
  };
  await Promise.all(Array.from({ length: Math.min(workerCount, perSeed.length) }, runNext));
  return mergeBotEvaluationResults(results);
}

function qualityReasons(result: BotEvaluationResult): string[] {
  const reasons: string[] = [];
  const baseline = result.variants.ruleRule!;
  const thiefWinRate = baseline.winnerCounts.THIEF / result.seeds;
  const policeWinRate = baseline.winnerCounts.POLICE / result.seeds;
  if (thiefWinRate < 0.4 || thiefWinRate > 0.6 || policeWinRate < 0.4 || policeWinRate > 0.6) reasons.push(`rule/rule 승률 ${thiefWinRate.toFixed(3)}:${policeWinRate.toFixed(3)}가 6:4 경계 밖입니다.`);
  for (const team of ['THIEF', 'POLICE'] as const) {
    const quality = baseline.quality[team];
    if (quality.stuckRatio >= 0.05) reasons.push(`${team} 막힘 비율이 5% 이상입니다.`);
    if (quality.ineffectiveActionsPerMinute > 6) reasons.push(`${team} 무효 행동이 분당 6회를 넘습니다.`);
    if (quality.oscillations > 0) reasons.push(`${team} 목표 진동이 관측되었습니다.`);
    if (quality.decisionErrors > 0) reasons.push(`${team} 판단 오류가 관측되었습니다.`);
  }
  return reasons;
}

/** 14→35→100 seed 게이트를 통과한 경우에만 다음 비용 단계와 최종 집계를 실행한다. */
export async function evaluateBotsStaged(seedCount = 100): Promise<StagedBotEvaluationResult> {
  const seedSet = selectStagedSeeds(seedCount);
  const stages: BotEvaluationStage[] = [];
  const gates = [...new Set([14, 35, seedCount])].filter((count) => count <= seedCount).sort((a, b) => a - b);
  const workers = configuredWorkers(seedCount);
  for (const count of gates) {
    const stageSet = { seeds: seedSet.seeds.slice(0, count), layouts: countLayouts(seedSet.seeds.slice(0, count)) };
    console.error(`[bot-evaluate] ${count} seeds, ${workers} workers`);
    const result = await evaluateSeedSetInWorkers(stageSet, Math.min(workers, count));
    const failedReasons = qualityReasons(result);
    const passed = failedReasons.length === 0;
    stages.push({ seeds: count, passed, failedReasons, result });
    if (!passed) return { workers, stages, final: null };
  }
  return { workers, stages, final: stages.at(-1)?.result ?? null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seedCount = Math.max(1, Number(process.env.BOT_EVAL_SEEDS ?? 100));
  const outcome = await evaluateBotsStaged(seedCount);
  console.log(JSON.stringify(outcome, null, 2));
  if (!outcome.final) process.exitCode = 2;
}
