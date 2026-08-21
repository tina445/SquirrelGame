import { describe, expect, it } from 'vitest';
import { distanceSquared, gameBalance, generateMap, validateMap, verifyMapHash } from '../src/index.js';

describe('deterministic procedural map generation', () => {
  it('produces an unchanged hash for the same seed', () => {
    const first = generateMap('regression-alpha').map;
    const second = generateMap('regression-alpha').map;
    expect(first).toEqual(second);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('ea74c086a1c86672');
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
      expect(result.map.teamSpawns.POLICE.every((spawn) => distanceSquared(spawn, result.map.jail.center) === 0)).toBe(true);
      const storageSpread = Math.max(...result.map.storages.flatMap((storage, index) => result.map.storages.slice(index + 1).map((other) => Math.sqrt(distanceSquared(storage.center, other.center)))));
      expect(storageSpread).toBeGreaterThan(15);
      if (result.map.layoutKind === 'RING') expect(result.map.playableHoles.length).toBeGreaterThan(0);
    }
    expect([...layouts].sort()).toEqual(['COURTYARD', 'CROSS', 'DIAMOND', 'GRAPH', 'H', 'LINE', 'RING']);
    expect(gameBalance.playerSpawnRadius).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('rejects a team spawn outside the playable polygon', () => {
    const map = structuredClone(generateMap('invalid-spawn').map);
    map.teamSpawns.THIEF[0] = { x: map.bounds.min.x, y: map.bounds.min.y };
    expect(validateMap(map).errors).toContain('team spawn is blocked');
  });

  it('uses the validated v5 fallback when retry attempts are exhausted', () => {
    const result = generateMap('forced-fallback', 0);
    expect(result.usedFallback).toBe(true);
    expect(result.map.seed).toBe('safe-meadow-v5');
    expect(result.map.hash).toBe('4670879b8c267d77');
    expect(validateMap(result.map)).toEqual({ valid: true, errors: [] });
  });
});
