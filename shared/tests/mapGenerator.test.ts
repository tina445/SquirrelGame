import { describe, expect, it } from 'vitest';
import { generateMap, validateMap, verifyMapHash } from '../src/index.js';

describe('deterministic procedural map generation', () => {
  it('produces an unchanged hash for the same seed', () => {
    const first = generateMap('regression-alpha').map;
    const second = generateMap('regression-alpha').map;
    expect(first).toEqual(second);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('ce293be57d8d3221');
    expect(verifyMapHash(first)).toBe(true);
    expect({ width: first.width, height: first.height, area: first.width * first.height }).toEqual({ width: 64, height: 48, area: 3_072 });
    expect(first.playableArea.length).toBeGreaterThan(4);
  });

  it('validates 1,000 generated seeds', () => {
    for (let index = 0; index < 1_000; index += 1) {
      const result = generateMap(`property-seed-${index}`);
      expect(validateMap(result.map), `seed ${index}`).toEqual({ valid: true, errors: [] });
      expect(result.map.storages).toHaveLength(3);
      expect(result.map.berrySpawnPoints.length).toBeGreaterThanOrEqual(8);
      expect(result.map.jail.escapePoints.length).toBeGreaterThanOrEqual(4);
      expect(result.map.playableArea).toHaveLength(8);
    }
  }, 30_000);

  it('rejects a team spawn outside the playable polygon', () => {
    const map = structuredClone(generateMap('invalid-spawn').map);
    map.teamSpawns.THIEF[0] = { x: map.bounds.min.x, y: map.bounds.min.y };
    expect(validateMap(map).errors).toContain('team spawn is blocked');
  });

  it('uses the validated v3 fallback when retry attempts are exhausted', () => {
    const result = generateMap('forced-fallback', 0);
    expect(result.usedFallback).toBe(true);
    expect(result.map.seed).toBe('safe-meadow-v3');
    expect(result.map.hash).toBe('a135792f46aaa0d3');
    expect(validateMap(result.map)).toEqual({ valid: true, errors: [] });
  });
});
