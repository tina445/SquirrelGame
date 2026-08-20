import { circleIntersectsAabb } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { Aabb, MapDefinition, StorageDefinition, Vec2, ZoneDefinition } from '../domain/types.js';
import { distanceSquared } from '../math/vector.js';
import { hashDefinition } from './hash.js';
import { SeededRandom } from './prng.js';
import { validateMap } from './validator.js';

export const generatorVersion = 1;
export const balanceVersion = 1;
export const fallbackSeed = 'safe-meadow-v1';
const width = 32;
const height = 24;

const zoneClear = (point: Vec2, zones: ZoneDefinition[], padding: number): boolean =>
  zones.every((zone) => distanceSquared(point, zone.center) > (zone.radius + padding) ** 2);

function makeRawMap(seed: string): MapDefinition {
  const random = new SeededRandom(seed);
  const thiefBase: ZoneDefinition = { id: 'thief-base', center: { x: -12, y: 0 }, radius: 2.25 };
  const storageCenters: Vec2[] = [{ x: 10, y: -7 }, { x: 13, y: 0 }, { x: 10, y: 7 }];
  const storages: StorageDefinition[] = storageCenters.map((center, index) => ({
    id: `storage-${index}` as StorageDefinition['id'], center, radius: 1.6,
    slotPositions: [-0.55, 0, 0.55].map((offset) => ({ x: center.x, y: center.y + offset }))
  }));
  const jailCenter = { x: 0, y: 8 };
  const jail = {
    id: 'jail', center: jailCenter, radius: 1.8,
    slots: [-0.75, -0.25, 0.25, 0.75].map((offset) => ({ x: jailCenter.x + offset, y: jailCenter.y })),
    escapePoints: [{ x: 0, y: 5.4 }, { x: 0, y: 10.6 }, { x: -2.6, y: 8 }, { x: 2.6, y: 8 }]
  };
  const protectedZones: ZoneDefinition[] = [thiefBase, jail, ...storages,
    { id: 'center', center: { x: 0, y: 0 }, radius: 3.2 }];
  const staticColliders: Aabb[] = [];
  const placementBands = [
    { min: { x: -9, y: -9 }, max: { x: -3, y: -3 } },
    { min: { x: -9, y: 3 }, max: { x: -3, y: 9 } },
    { min: { x: 3, y: -9 }, max: { x: 7, y: -3 } },
    { min: { x: 3, y: 3 }, max: { x: 7, y: 6 } }
  ];
  for (const band of placementBands) {
    const count = 2 + random.integer(0, 2);
    for (let index = 0; index < count; index += 1) {
      const center = { x: random.range(band.min.x, band.max.x), y: random.range(band.min.y, band.max.y) };
      const half = { x: random.range(0.45, 0.9), y: random.range(0.45, 0.9) };
      if (!zoneClear(center, protectedZones, Math.max(half.x, half.y) + 0.7)) continue;
      const candidate = { min: { x: center.x - half.x, y: center.y - half.y }, max: { x: center.x + half.x, y: center.y + half.y } };
      if (!staticColliders.some((item) => candidate.min.x < item.max.x + 1 && candidate.max.x > item.min.x - 1 && candidate.min.y < item.max.y + 1 && candidate.max.y > item.min.y - 1)) staticColliders.push(candidate);
    }
  }
  const berrySpawnPoints: Vec2[] = [
    { x: -8, y: -7 }, { x: -8, y: 7 }, { x: -4, y: 0 }, { x: 0, y: -8 },
    { x: 0, y: 4 }, { x: 4, y: 0 }, { x: 5, y: -7 }, { x: 5, y: 7 },
    { x: 8, y: -3 }, { x: 8, y: 3 }, { x: -3, y: -5 }, { x: 3, y: -4 }
  ].map((point) => ({ x: point.x + random.range(-0.3, 0.3), y: point.y + random.range(-0.3, 0.3) }))
    .filter((point) => !staticColliders.some((box) => circleIntersectsAabb(point, 0.5, box)) && zoneClear(point, protectedZones, 0.5));
  while (berrySpawnPoints.length < 8) berrySpawnPoints.push({ x: random.range(-4, 4), y: random.range(-7, -4) });
  const paths = storages.flatMap((storage) => [
    { from: thiefBase.id, to: storage.id, points: [thiefBase.center, { x: 0, y: storage.center.y * 0.35 }, storage.center], length: 22 + Math.abs(storage.center.y) * 0.2 },
    { from: jail.id, to: storage.id, points: [jail.center, { x: 5, y: 4 }, storage.center], length: 16 }
  ]);
  const mapWithoutHash = {
    id: `map-${seed}`, seed, generatorVersion, balanceVersion, width, height,
    bounds: { min: { x: -width / 2, y: -height / 2 }, max: { x: width / 2, y: height / 2 } },
    teamSpawns: {
      THIEF: [-1.2, -0.4, 0.4, 1.2].map((y) => ({ x: -12, y })),
      POLICE: [-1.5, -0.5, 0.5, 1.5].map((y) => ({ x: 8, y }))
    },
    thiefBase, jail, storages, staticColliders, occluders: staticColliders,
    paths, berrySpawnPoints, decorativeSockets: staticColliders.map((box) => ({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }))
  };
  return { ...mapWithoutHash, hash: hashDefinition(mapWithoutHash) };
}

export interface GeneratedMap { map: MapDefinition; requestedSeed: string; attempts: number; usedFallback: boolean; warnings: string[] }

export function generateMap(seed: string, maximumAttempts = 8): GeneratedMap {
  const warnings: string[] = [];
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const derivedSeed = attempt === 0 ? seed : `${seed}:${attempt}`;
    const map = makeRawMap(derivedSeed);
    const result = validateMap(map);
    if (result.valid) return { map, requestedSeed: seed, attempts: attempt + 1, usedFallback: false, warnings };
    warnings.push(`seed ${derivedSeed}: ${result.errors.join('; ')}`);
  }
  const map = makeRawMap(fallbackSeed);
  const validation = validateMap(map);
  if (!validation.valid) throw new Error(`Fallback map is invalid: ${validation.errors.join('; ')}`);
  warnings.push(`fallback seed ${fallbackSeed} selected`);
  return { map, requestedSeed: seed, attempts: maximumAttempts, usedFallback: true, warnings };
}

export function verifyMapHash(map: MapDefinition): boolean {
  const { hash: _hash, ...withoutHash } = map;
  return hashDefinition(withoutHash) === map.hash;
}

export function randomMapSeed(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff_ffff).toString(36)}`;
}
