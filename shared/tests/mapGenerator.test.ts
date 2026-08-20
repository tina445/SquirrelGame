import { describe, expect, it } from 'vitest';
import { generateMap, validateMap, verifyMapHash } from '../src/index.js';

describe('deterministic procedural map generation', () => {
  it('produces an unchanged hash for the same seed', () => {
    const first = generateMap('regression-alpha').map;
    const second = generateMap('regression-alpha').map;
    expect(first).toEqual(second);
    expect(first.hash).toBe(second.hash);
    expect(verifyMapHash(first)).toBe(true);
    expect({ width: first.width, height: first.height, area: first.width * first.height }).toEqual({ width: 64, height: 48, area: 3_072 });
  });

  it('validates 1,000 generated seeds', () => {
    for (let index = 0; index < 1_000; index += 1) {
      const result = generateMap(`property-seed-${index}`);
      expect(validateMap(result.map), `seed ${index}`).toEqual({ valid: true, errors: [] });
      expect(result.map.storages).toHaveLength(3);
      expect(result.map.berrySpawnPoints.length).toBeGreaterThanOrEqual(8);
      expect(result.map.jail.escapePoints.length).toBeGreaterThanOrEqual(4);
    }
  }, 30_000);
});
