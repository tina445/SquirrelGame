import { describe, expect, it } from 'vitest';
import { distanceSquared, gameBalance, generateMap, validateMap, verifyMapHash } from '../src/index.js';

describe('deterministic procedural map generation', () => {
  it('produces an unchanged hash for the same seed', () => {
    const first = generateMap('regression-alpha').map;
    const second = generateMap('regression-alpha').map;
    expect(first).toEqual(second);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('e8fb23fbe6080493');
    expect(verifyMapHash(first)).toBe(true);
    expect({ width: first.width, height: first.height, area: first.width * first.height }).toEqual({ width: 192, height: 144, area: 27_648 });
    expect({ thiefBase: first.thiefBase.radius, storage: first.storages[0]!.radius, jail: first.jail.radius }).toEqual({ thiefBase: 3, storage: 2.2, jail: 2.6 });
    expect(first.playableArea.length).toBeGreaterThan(4);
  });

  it('validates 1,000 generated seeds', () => {
    const layouts = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      const result = generateMap(`property-seed-${index}`);
      layouts.add(result.map.layoutKind);
      expect(validateMap(result.map), `seed ${index}`).toEqual({ valid: true, errors: [] });
      expect(result.map.storages).toHaveLength(3);
      expect(result.map.berrySpawnPoints.length).toBeGreaterThanOrEqual(gameBalance.berrySpawnPointTarget);
      for (let berryIndex = 0; berryIndex < result.map.berrySpawnPoints.length; berryIndex += 1) for (const other of result.map.berrySpawnPoints.slice(berryIndex + 1)) {
        expect(Math.sqrt(distanceSquared(result.map.berrySpawnPoints[berryIndex]!, other))).toBeGreaterThanOrEqual(gameBalance.berrySpawnPointMinSeparation);
      }
      expect(result.map.jail.escapePoints.length).toBeGreaterThanOrEqual(4);
      expect(result.map.playableArea.length).toBeGreaterThanOrEqual(8);
      expect(result.map.trees.length).toBeGreaterThanOrEqual(gameBalance.treeTarget);
      expect(result.map.rockPiles.length).toBeGreaterThanOrEqual(gameBalance.rockPileTarget);
      expect(result.map.bushes.length).toBeGreaterThanOrEqual(gameBalance.bushTarget);
      expect(result.map.dirtPaths).toHaveLength(result.map.paths.length);
      expect(result.map.paths).toHaveLength(4);
      expect(result.map.dirtPaths.every((path) => path.width === 2.15 && path.points.length >= 2)).toBe(true);
      expect(Math.max(...result.map.trees.map((tree) => tree.trunkRadius))).toBeLessThanOrEqual(0.65);
      expect(result.map.teamSpawns.POLICE.every((spawn) => Math.sqrt(distanceSquared(spawn, result.map.jail.center)) > result.map.jail.radius + gameBalance.playerRadius + gameBalance.policeSpawnRadius)).toBe(true);
      const storageSpread = Math.max(...result.map.storages.flatMap((storage, index) => result.map.storages.slice(index + 1).map((other) => Math.sqrt(distanceSquared(storage.center, other.center)))));
      expect(storageSpread).toBeGreaterThan(45);
      if (result.map.layoutKind === 'RING') expect(result.map.playableHoles.length).toBeGreaterThan(0);
    }
    expect([...layouts].sort()).toEqual(['COURTYARD', 'CROSS', 'DIAMOND', 'GRAPH', 'H', 'LINE', 'RING']);
    expect(gameBalance.playerSpawnRadius).toBeGreaterThanOrEqual(4);
    expect(gameBalance.playerRadius).toBeGreaterThan(0.5);
  }, 30_000);

  it('rejects a team spawn outside the playable polygon', () => {
    const map = structuredClone(generateMap('invalid-spawn').map);
    map.teamSpawns.THIEF[0] = { x: map.bounds.min.x, y: map.bounds.min.y };
    expect(validateMap(map).errors).toContain('team spawn is blocked');
  });

  it('uses the validated v14 fallback when retry attempts are exhausted', () => {
    const result = generateMap('forced-fallback', 0);
    expect(result.usedFallback).toBe(true);
    expect(result.map.seed).toBe('safe-meadow-v14');
    expect(result.map.hash).toBe('493dc3820aa42e1e');
    expect(validateMap(result.map)).toEqual({ valid: true, errors: [] });
  });
});
