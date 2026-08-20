import { circleIntersectsAabb } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { Aabb, MapDefinition, StorageDefinition, Vec2, ZoneDefinition } from '../domain/types.js';
import { distanceSquared } from '../math/vector.js';
import { hashDefinition } from './hash.js';
import { SeededRandom } from './prng.js';
import { validateMap } from './validator.js';

export const generatorVersion = 2;
export const balanceVersion = 2;
export const fallbackSeed = 'safe-meadow-v2';
const width = gameBalance.mapWidth;
const height = gameBalance.mapHeight;
const layoutScale = 2;
const layoutPoint = (x: number, y: number): Vec2 => ({ x: x * layoutScale, y: y * layoutScale });
const pathLength = (points: Vec2[]): number => points.slice(1).reduce((length, point, index) => length + Math.sqrt(distanceSquared(points[index]!, point)), 0);

const zoneClear = (point: Vec2, zones: ZoneDefinition[], padding: number): boolean =>
  zones.every((zone) => distanceSquared(point, zone.center) > (zone.radius + padding) ** 2);

/** 하나의 파생 seed에서 아직 검증되지 않은 맵 후보와 해시를 결정론적으로 생성한다. */
function makeRawMap(seed: string): MapDefinition {
  const random = new SeededRandom(seed);
  const thiefBase: ZoneDefinition = { id: 'thief-base', center: layoutPoint(-12, 0), radius: 2.25 };
  const storageCenters: Vec2[] = [layoutPoint(10, -7), layoutPoint(13, 0), layoutPoint(10, 7)];
  const storages: StorageDefinition[] = storageCenters.map((center, index) => ({
    id: `storage-${index}` as StorageDefinition['id'], center, radius: 1.6,
    slotPositions: [-0.55, 0, 0.55].map((offset) => ({ x: center.x, y: center.y + offset }))
  }));
  const jailCenter = layoutPoint(0, 8);
  const jail = {
    id: 'jail', center: jailCenter, radius: 1.8,
    slots: [-0.75, -0.25, 0.25, 0.75].map((offset) => ({ x: jailCenter.x + offset, y: jailCenter.y })),
    escapePoints: [
      { x: jailCenter.x, y: jailCenter.y - 2.6 }, { x: jailCenter.x, y: jailCenter.y + 2.6 },
      { x: jailCenter.x - 2.6, y: jailCenter.y }, { x: jailCenter.x + 2.6, y: jailCenter.y }
    ]
  };
  const protectedZones: ZoneDefinition[] = [thiefBase, jail, ...storages,
    { id: 'center', center: { x: 0, y: 0 }, radius: 3.2 }];
  const staticColliders: Aabb[] = [];
  const placementBands = [
    { min: layoutPoint(-9, -9), max: layoutPoint(-3, -3) },
    { min: layoutPoint(-9, 3), max: layoutPoint(-3, 9) },
    { min: layoutPoint(3, -9), max: layoutPoint(7, -3) },
    { min: layoutPoint(3, 3), max: layoutPoint(7, 6) }
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
    layoutPoint(-8, -7), layoutPoint(-8, 7), layoutPoint(-4, 0), layoutPoint(0, -8),
    layoutPoint(0, 4), layoutPoint(4, 0), layoutPoint(5, -7), layoutPoint(5, 7),
    layoutPoint(8, -3), layoutPoint(8, 3), layoutPoint(-3, -5), layoutPoint(3, -4)
  ].map((point) => ({ x: point.x + random.range(-0.3, 0.3), y: point.y + random.range(-0.3, 0.3) }))
    .filter((point) => !staticColliders.some((box) => circleIntersectsAabb(point, 0.5, box)) && zoneClear(point, protectedZones, 0.5));
  while (berrySpawnPoints.length < 8) berrySpawnPoints.push({ x: random.range(-8, 8), y: random.range(-14, -8) });
  const paths = storages.flatMap((storage) => {
    const basePath = [thiefBase.center, { x: 0, y: storage.center.y * 0.35 }, storage.center];
    const jailPath = [jail.center, layoutPoint(5, 4), storage.center];
    return [
      { from: thiefBase.id, to: storage.id, points: basePath, length: pathLength(basePath) },
      { from: jail.id, to: storage.id, points: jailPath, length: pathLength(jailPath) }
    ];
  });
  const mapWithoutHash = {
    id: `map-${seed}`, seed, generatorVersion, balanceVersion, width, height,
    bounds: { min: { x: -width / 2, y: -height / 2 }, max: { x: width / 2, y: height / 2 } },
    teamSpawns: {
      THIEF: [-1.2, -0.4, 0.4, 1.2].map((y) => ({ x: thiefBase.center.x, y })),
      POLICE: [-1.5, -0.5, 0.5, 1.5].map((y) => ({ x: 16, y }))
    },
    thiefBase, jail, storages, staticColliders, occluders: staticColliders,
    paths, berrySpawnPoints, decorativeSockets: staticColliders.map((box) => ({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }))
  };
  return { ...mapWithoutHash, hash: hashDefinition(mapWithoutHash) };
}

export interface GeneratedMap { map: MapDefinition; requestedSeed: string; attempts: number; usedFallback: boolean; warnings: string[] }

/** 후보를 제한 횟수만큼 생성·검증하고 모두 실패하면 검증된 고정 seed로 안전하게 대체한다. */
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

/** 수신한 MapDefinition에서 hash 필드를 제외해 다시 계산하고 전송 중 불일치를 확인한다. */
export function verifyMapHash(map: MapDefinition): boolean {
  const withoutHash = Object.fromEntries(Object.entries(map).filter(([key]) => key !== 'hash'));
  return hashDefinition(withoutHash) === map.hash;
}

/** 새 Room에 사용할 충돌 가능성이 낮은 비결정 입력 seed를 생성한다. */
export function randomMapSeed(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff_ffff).toString(36)}`;
}
