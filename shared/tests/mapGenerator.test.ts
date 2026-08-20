import { describe, expect, it } from 'vitest';
import { generateMap, validateMap, verifyMapHash } from '../src/index.js';

describe('deterministic procedural map generation', () => {
  it('produces an unchanged hash for the same seed', () => {
    const first = generateMap('regression-alpha').map;
    const second = generateMap('regression-alpha').map;
    expect(first).toEqual(second);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('81c0dae9fb588091');
    expect(verifyMapHash(first)).toBe(true);
    expect({ width: first.width, height: first.height, area: first.width * first.height }).toEqual({ width: 64, height: 48, area: 3_072 });
    expect(first.playableArea.length).toBeGreaterThan(4);
  });

  it('validates 1,000 generated seeds', () => {
    const layouts = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      const result = generateMap(`property-seed-${index}`);
      layouts.add(result.map.layoutKind);
      expect(validateMap(result.map), `seed ${index}`).toEqual({ valid: true, errors: [] });
      expect(result.map.storages).toHaveLength(3);
      expect(result.map.berrySpawnPoints.length).toBeGreaterThanOrEqual(8);
      expect(result.map.jail.escapePoints.length).toBeGreaterThanOrEqual(4);
      expect(result.map.playableArea.length).toBeGreaterThanOrEqual(8);
      expect(result.map.trees.length).toBeGreaterThanOrEqual(4);
      if (result.map.layoutKind === 'RING') expect(result.map.playableHoles.length).toBeGreaterThan(0);
    }
    expect([...layouts].sort()).toEqual(['GRAPH', 'H', 'LINE', 'RING']);
  }, 30_000);

  it('rejects a team spawn outside the playable polygon', () => {
    const map = structuredClone(generateMap('invalid-spawn').map);
    map.teamSpawns.THIEF[0] = { x: map.bounds.min.x, y: map.bounds.min.y };
    expect(validateMap(map).errors).toContain('team spawn is blocked');
  });

  it('uses the validated v4 fallback when retry attempts are exhausted', () => {
    const result = generateMap('forced-fallback', 0);
    expect(result.usedFallback).toBe(true);
    expect(result.map.seed).toBe('safe-meadow-v4');
    expect(result.map.hash).toBe('600db2b2ed8b05be');
    expect(validateMap(result.map)).toEqual({ valid: true, errors: [] });
  });
});
