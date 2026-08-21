import { evaluateBots } from './evaluation.js';

const seedCount = Math.max(1, Number(process.env.BOT_EVAL_SEEDS ?? 100));
const originalInfo = console.info;
console.info = () => undefined;
const result = evaluateBots(seedCount, (completed, total) => {
  if (completed === total || completed % 10 === 0) console.error(`[bot-evaluate] ${completed}/${total} seeds`);
});
console.info = originalInfo;
console.log(JSON.stringify(result, null, 2));
