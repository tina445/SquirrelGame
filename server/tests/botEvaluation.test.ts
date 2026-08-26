import { describe, expect, it } from 'vitest';
import { generateMap } from '@squirrel-heist/shared';
import { selectEvaluationSeeds } from '../src/bot/evaluation.js';
import { selectStagedSeeds } from '../src/bot/evaluateBots.js';

describe('bot evaluation seed selection', () => {
  it('is deterministic and balances all layout families within one seed', () => {
    const first = selectEvaluationSeeds(100);
    const second = selectEvaluationSeeds(100);
    expect(first).toEqual(second);
    expect(first.seeds).toHaveLength(100);
    expect(Object.keys(first.layouts)).toHaveLength(7);
    const counts = Object.values(first.layouts);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  }, 10_000);

  it('keeps every staged prefix deterministic and layout-balanced', () => {
    const first = selectStagedSeeds(100);
    const second = selectStagedSeeds(100);
    expect(first).toEqual(second);
    for (const count of [14, 35, 100]) {
      const layouts: Record<string, number> = {};
      for (const seed of first.seeds.slice(0, count)) {
        const layout = generateMap(seed).map.layoutKind;
        layouts[layout] = (layouts[layout] ?? 0) + 1;
      }
      const counts = Object.values(layouts);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  }, 10_000);
});
