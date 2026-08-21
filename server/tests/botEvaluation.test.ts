import { describe, expect, it } from 'vitest';
import { selectEvaluationSeeds } from '../src/bot/evaluation.js';

describe('bot evaluation seed selection', () => {
  it('is deterministic and balances all layout families within one seed', () => {
    const first = selectEvaluationSeeds(100);
    const second = selectEvaluationSeeds(100);
    expect(first).toEqual(second);
    expect(first.seeds).toHaveLength(100);
    expect(Object.keys(first.layouts)).toHaveLength(7);
    const counts = Object.values(first.layouts);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
