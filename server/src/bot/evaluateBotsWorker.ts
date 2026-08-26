import { evaluateBotsForSeedSet, type BotEvaluationSeedSet } from './evaluation.js';

interface EvaluationWorkerRequest {
  seedSet: BotEvaluationSeedSet;
}

/** 부모가 나눈 고정 seed만 평가하고, 집계는 부모 프로세스에 맡긴다. */
process.on('message', (message: EvaluationWorkerRequest) => {
  const originalInfo = console.info;
  console.info = () => undefined;
  let response: { result?: ReturnType<typeof evaluateBotsForSeedSet>; error?: string };
  try {
    response = { result: evaluateBotsForSeedSet(message.seedSet) };
  } catch (error) {
    response = { error: error instanceof Error ? error.stack ?? error.message : String(error) };
  } finally {
    console.info = originalInfo;
  }
  // IPC flush 전 disconnect하면 병렬 실행에서 마지막 결과가 유실될 수 있다.
  process.send?.(response!, () => process.disconnect());
});
