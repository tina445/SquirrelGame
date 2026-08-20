import { circleIntersectsAabb, circleIntersectsCircle, isCircleInPlayableArea } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { Aabb, MapDefinition, MapLayoutKind, StorageDefinition, TreeDefinition, Vec2, ZoneDefinition } from '../domain/types.js';
import { distanceSquared } from '../math/vector.js';
import { hashDefinition } from './hash.js';
import { SeededRandom } from './prng.js';
import { validateMap } from './validator.js';

export const generatorVersion = 4;
export const balanceVersion = 2;
export const fallbackSeed = 'safe-meadow-v4';
const width = gameBalance.mapWidth;
const height = gameBalance.mapHeight;
const bounds = { min: { x: -width / 2, y: -height / 2 }, max: { x: width / 2, y: height / 2 } };
const pathLength = (points: Vec2[]): number => points.slice(1).reduce((length, point, index) => length + Math.sqrt(distanceSquared(points[index]!, point)), 0);

interface LayoutTemplate {
  kind: MapLayoutKind;
  playableArea: Vec2[];
  playableHoles: Vec2[][];
  thiefBase: Vec2;
  storageCenters: Vec2[];
  jail: Vec2;
  policeSpawn: Vec2;
  obstacleCenters: Array<{ center: Vec2; half: Vec2 }>;
}

/** seed가 선택한 네 가지 topology를 실제 이동 polygon·hole·anchor template로 변환한다. */
function createLayout(kind: MapLayoutKind, random: SeededRandom): LayoutTemplate {
  const jitter = (point: Vec2, amount = 0.45): Vec2 => ({ x: point.x + random.range(-amount, amount), y: point.y + random.range(-amount, amount) });
  if (kind === 'LINE') return {
    kind,
    playableArea: [{ x: -30, y: -9 }, { x: 30, y: -9 }, { x: 32, y: -6 }, { x: 32, y: 6 }, { x: 30, y: 9 }, { x: -30, y: 9 }, { x: -32, y: 6 }, { x: -32, y: -6 }],
    playableHoles: [], thiefBase: jitter({ x: -26, y: 0 }),
    storageCenters: [jitter({ x: 23, y: -5 }, 0.3), jitter({ x: 27, y: 0 }, 0.3), jitter({ x: 23, y: 5 }, 0.3)],
    jail: jitter({ x: 0, y: 5.5 }, 0.25), policeSpawn: { x: 17, y: 0 },
    obstacleCenters: [
      { center: { x: -13, y: -4.8 }, half: { x: 0.7, y: 2 } }, { center: { x: -4, y: 4.8 }, half: { x: 0.7, y: 2 } },
      { center: { x: 6, y: -4.8 }, half: { x: 0.7, y: 2 } }, { center: { x: 14, y: 4.8 }, half: { x: 0.7, y: 2 } }
    ]
  };
  if (kind === 'H') return {
    kind,
    playableArea: [
      { x: -30, y: -21 }, { x: -18, y: -21 }, { x: -18, y: -6 }, { x: 18, y: -6 },
      { x: 18, y: -21 }, { x: 30, y: -21 }, { x: 30, y: 21 }, { x: 18, y: 21 },
      { x: 18, y: 6 }, { x: -18, y: 6 }, { x: -18, y: 21 }, { x: -30, y: 21 }
    ],
    playableHoles: [], thiefBase: jitter({ x: -25, y: 0 }),
    storageCenters: [jitter({ x: 24, y: -14 }, 0.35), jitter({ x: 25, y: 0 }, 0.35), jitter({ x: 24, y: 14 }, 0.35)],
    jail: jitter({ x: 0, y: 0 }, 0.25), policeSpawn: { x: 20, y: 0 },
    obstacleCenters: [
      { center: { x: -24, y: -11 }, half: { x: 1.5, y: 0.6 } }, { center: { x: -24, y: 11 }, half: { x: 1.5, y: 0.6 } },
      { center: { x: 24, y: -7 }, half: { x: 1.3, y: 0.6 } }, { center: { x: 24, y: 8 }, half: { x: 1.3, y: 0.6 } }
    ]
  };
  if (kind === 'RING') return {
    kind,
    playableArea: [{ x: -28, y: -23 }, { x: 28, y: -23 }, { x: 32, y: -19 }, { x: 32, y: 19 }, { x: 28, y: 23 }, { x: -28, y: 23 }, { x: -32, y: 19 }, { x: -32, y: -19 }],
    playableHoles: [[{ x: -10, y: -9 }, { x: 10, y: -9 }, { x: 10, y: 9 }, { x: -10, y: 9 }]],
    thiefBase: jitter({ x: -25, y: 0 }),
    storageCenters: [jitter({ x: 20, y: -15 }, 0.35), jitter({ x: 26, y: 0 }, 0.35), jitter({ x: 20, y: 15 }, 0.35)],
    jail: jitter({ x: 0, y: 16 }, 0.25), policeSpawn: { x: 20, y: 0 },
    obstacleCenters: [
      { center: { x: -16, y: -15 }, half: { x: 1.5, y: 0.6 } }, { center: { x: 4, y: -16 }, half: { x: 1.5, y: 0.6 } },
      { center: { x: -5, y: 16 }, half: { x: 1.4, y: 0.6 } }, { center: { x: 14, y: 14 }, half: { x: 1.2, y: 0.6 } }
    ]
  };
  const cuts = Array.from({ length: 4 }, () => random.range(4, 8));
  return {
    kind,
    playableArea: [
      { x: -32 + cuts[0]!, y: -24 }, { x: 32 - cuts[1]!, y: -24 }, { x: 32, y: -24 + cuts[1]! }, { x: 32, y: 24 - cuts[2]! },
      { x: 32 - cuts[2]!, y: 24 }, { x: -32 + cuts[3]!, y: 24 }, { x: -32, y: 24 - cuts[3]! }, { x: -32, y: -24 + cuts[0]! }
    ],
    playableHoles: [], thiefBase: jitter({ x: -24, y: 0 }),
    storageCenters: [jitter({ x: 20, y: -14 }), jitter({ x: 25, y: 0 }), jitter({ x: 20, y: 14 })],
    jail: jitter({ x: 0, y: 16 }), policeSpawn: { x: 17, y: 0 },
    obstacleCenters: [
      { center: { x: -14, y: -10 }, half: { x: 1.5, y: 0.7 } }, { center: { x: -13, y: 10 }, half: { x: 0.7, y: 1.6 } },
      { center: { x: -5, y: -5 }, half: { x: 0.7, y: 1.8 } }, { center: { x: 3, y: 7 }, half: { x: 1.8, y: 0.7 } },
      { center: { x: 9, y: -10 }, half: { x: 1.6, y: 0.7 } }, { center: { x: 12, y: 5 }, half: { x: 0.7, y: 1.6 } }
    ]
  };
}

const zoneClear = (point: Vec2, zones: ZoneDefinition[], padding: number): boolean =>
  zones.every((zone) => distanceSquared(point, zone.center) > (zone.radius + padding) ** 2);

/** layout topology에 맞는 우회점을 넣어 anchor 사이의 의도된 이동 graph metadata를 만든다. */
function route(kind: MapLayoutKind, from: Vec2, to: Vec2, lane = 1): Vec2[] {
  if (kind === 'RING') {
    const y = lane < 0 ? -12 : 12;
    return [from, { x: -13, y }, { x: 13, y }, to];
  }
  if (kind === 'H') return [from, { x: from.x < 0 ? -15 : 15, y: 0 }, { x: 15, y: 0 }, { x: 22, y: to.y }, to];
  if (kind === 'GRAPH') return [from, { x: -8, y: lane * 6 }, { x: 7, y: lane * 6 }, to];
  return [from, { x: 0, y: Math.max(-4, Math.min(4, to.y)) }, to];
}

/** 하나의 파생 seed에서 layout·장애물·나무·아이템 후보를 결정론적으로 생성한다. */
function makeRawMap(seed: string): MapDefinition {
  const random = new SeededRandom(seed);
  const kinds: MapLayoutKind[] = ['LINE', 'H', 'RING', 'GRAPH'];
  const layout = createLayout(kinds[random.integer(0, kinds.length)]!, random);
  const thiefBase: ZoneDefinition = { id: 'thief-base', center: layout.thiefBase, radius: 2.25 };
  const storages: StorageDefinition[] = layout.storageCenters.map((center, index) => ({
    id: `storage-${index}` as StorageDefinition['id'], center, radius: 1.6,
    slotPositions: [-0.55, 0, 0.55].map((offset) => ({ x: center.x, y: center.y + offset }))
  }));
  const jailCenter = layout.jail;
  const jail = {
    id: 'jail', center: jailCenter, radius: 1.8,
    slots: [-0.75, -0.25, 0.25, 0.75].map((offset) => ({ x: jailCenter.x + offset, y: jailCenter.y })),
    escapePoints: [
      { x: jailCenter.x, y: jailCenter.y - 2.6 }, { x: jailCenter.x, y: jailCenter.y + 2.6 },
      { x: jailCenter.x - 2.6, y: jailCenter.y }, { x: jailCenter.x + 2.6, y: jailCenter.y }
    ]
  };
  const protectedZones: ZoneDefinition[] = [thiefBase, jail, ...storages];
  const staticColliders: Aabb[] = [];
  for (const template of layout.obstacleCenters) {
    const center = { x: template.center.x + random.range(-0.5, 0.5), y: template.center.y + random.range(-0.5, 0.5) };
    if (!zoneClear(center, protectedZones, Math.max(template.half.x, template.half.y) + 0.8)) continue;
    const candidate = { min: { x: center.x - template.half.x, y: center.y - template.half.y }, max: { x: center.x + template.half.x, y: center.y + template.half.y } };
    const corners = [candidate.min, candidate.max, { x: candidate.min.x, y: candidate.max.y }, { x: candidate.max.x, y: candidate.min.y }];
    if (corners.every((point) => isCircleInPlayableArea(point, 0.25, bounds, layout.playableArea, layout.playableHoles))) staticColliders.push(candidate);
  }

  const trees: TreeDefinition[] = [];
  for (let attempt = 0; trees.length < 7 && attempt < 1_000; attempt += 1) {
    const trunkRadius = random.range(0.68, 0.9);
    const canopyRadius = random.range(2.05, 2.65);
    const center = { x: random.range(-28, 28), y: random.range(-20, 20) };
    if (!isCircleInPlayableArea(center, canopyRadius, bounds, layout.playableArea, layout.playableHoles) ||
      !zoneClear(center, protectedZones, canopyRadius + 0.7) ||
      staticColliders.some((box) => circleIntersectsAabb(center, canopyRadius + 0.35, box)) ||
      trees.some((tree) => circleIntersectsCircle(center, canopyRadius + 0.6, tree.center, tree.canopyRadius))) continue;
    trees.push({ id: `tree-${trees.length}`, center, trunkRadius, canopyRadius });
  }

  const berrySpawnPoints: Vec2[] = [];
  for (let attempt = 0; berrySpawnPoints.length < 12 && attempt < 2_000; attempt += 1) {
    const point = { x: random.range(-29, 29), y: random.range(-21, 21) };
    const clearance = gameBalance.berryPickupRadius + gameBalance.berrySpawnRadius;
    const valid = isCircleInPlayableArea(point, clearance, bounds, layout.playableArea, layout.playableHoles) &&
      !staticColliders.some((box) => circleIntersectsAabb(point, clearance, box)) &&
      !trees.some((tree) => circleIntersectsCircle(point, clearance, tree.center, tree.trunkRadius)) &&
      zoneClear(point, protectedZones, clearance) && berrySpawnPoints.every((existing) => distanceSquared(point, existing) >= (gameBalance.berrySpawnRadius * 2) ** 2);
    if (valid) berrySpawnPoints.push(point);
  }

  const paths = storages.flatMap((storage, index) => {
    const basePath = route(layout.kind, thiefBase.center, storage.center, index === 0 ? -1 : 1);
    const jailPath = route(layout.kind, jail.center, storage.center, index === 0 ? -1 : 1);
    return [
      { from: thiefBase.id, to: storage.id, points: basePath, length: pathLength(basePath) },
      { from: jail.id, to: storage.id, points: jailPath, length: pathLength(jailPath) }
    ];
  });
  const mapWithoutHash = {
    id: `map-${seed}`, seed, generatorVersion, balanceVersion, layoutKind: layout.kind, width, height, bounds,
    playableArea: layout.playableArea, playableHoles: layout.playableHoles,
    teamSpawns: {
      THIEF: [-1.8, -0.6, 0.6, 1.8].map((offset) => ({ x: thiefBase.center.x, y: thiefBase.center.y + offset })),
      POLICE: [-1.8, -0.6, 0.6, 1.8].map((offset) => ({ x: layout.policeSpawn.x, y: layout.policeSpawn.y + offset }))
    },
    thiefBase, jail, storages, staticColliders, occluders: staticColliders, trees, paths, berrySpawnPoints,
    decorativeSockets: trees.map((tree) => ({ ...tree.center }))
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
