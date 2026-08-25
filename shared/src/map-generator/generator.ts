import { circleIntersectsAabb, circleIntersectsCircle, isCircleInPlayableArea } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { Aabb, BushDefinition, DirtPathDefinition, MapDefinition, MapLayoutKind, PathMetadata, RockPileDefinition, StorageDefinition, TreeDefinition, Vec2, ZoneDefinition } from '../domain/types.js';
import { distanceSquared } from '../math/vector.js';
import { hashDefinition } from './hash.js';
import { SeededRandom } from './prng.js';
import { validateMap } from './validator.js';

export const generatorVersion = 14;
export const balanceVersion = 8;
export const fallbackSeed = 'safe-meadow-v14';
const width = gameBalance.mapWidth;
const height = gameBalance.mapHeight;
const mapScale = gameBalance.mapScale;
const terrainChunkSize = gameBalance.terrainChunkSize;
const bounds = { min: { x: -width / 2, y: -height / 2 }, max: { x: width / 2, y: height / 2 } };
const pathLength = (points: Vec2[]): number => points.slice(1).reduce((length, point, index) => length + Math.sqrt(distanceSquared(points[index]!, point)), 0);

interface TerrainChunk { column: number; row: number; center: Vec2 }

/** 서버 생성과 클라이언트 장식이 같은 10×10 grid를 기준으로 소품 후보를 고르도록 playable chunk를 열거한다. */
function terrainChunks(layout: Pick<LayoutTemplate, 'playableArea' | 'playableHoles'>): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  const startX = Math.floor(bounds.min.x / terrainChunkSize) * terrainChunkSize;
  const startY = Math.floor(bounds.min.y / terrainChunkSize) * terrainChunkSize;
  const endX = Math.ceil(bounds.max.x / terrainChunkSize) * terrainChunkSize;
  const endY = Math.ceil(bounds.max.y / terrainChunkSize) * terrainChunkSize;
  for (let x = startX, column = 0; x < endX; x += terrainChunkSize, column += 1) for (let y = startY, row = 0; y < endY; y += terrainChunkSize, row += 1) {
    const center = { x: x + terrainChunkSize / 2, y: y + terrainChunkSize / 2 };
    if (isCircleInPlayableArea(center, 0, bounds, layout.playableArea, layout.playableHoles)) chunks.push({ column, row, center });
  }
  return chunks;
}

/** 점과 path segment의 거리 제곱을 계산해 장애물 장식이 주요 흙길을 덮지 않게 한다. */
function pointSegmentDistanceSquared(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return (point.x - (start.x + dx * t)) ** 2 + (point.y - (start.y + dy * t)) ** 2;
}

interface LayoutTemplate {
  kind: MapLayoutKind;
  playableArea: Vec2[];
  playableHoles: Vec2[][];
  thiefBase: Vec2;
  storageCenters: Vec2[];
  jail: Vec2;
  obstacleCenters: Array<{ center: Vec2; half: Vec2 }>;
}

/** seed가 선택한 topology를 기준 좌표계의 polygon·hole·anchor template로 변환한다. */
function createBaseLayout(kind: MapLayoutKind, random: SeededRandom): LayoutTemplate {
  const jitter = (point: Vec2, amount = 0.45): Vec2 => ({ x: point.x + random.range(-amount, amount), y: point.y + random.range(-amount, amount) });
  if (kind === 'LINE') return {
    kind,
    playableArea: [{ x: -30, y: -9 }, { x: 30, y: -9 }, { x: 32, y: -6 }, { x: 32, y: 6 }, { x: 30, y: 9 }, { x: -30, y: 9 }, { x: -32, y: 6 }, { x: -32, y: -6 }],
    playableHoles: [], thiefBase: jitter({ x: -26, y: 0 }),
    storageCenters: [jitter({ x: 10, y: -5 }, 0.3), jitter({ x: 27, y: 0 }, 0.3), jitter({ x: 19, y: 5 }, 0.3)],
    jail: jitter({ x: 0, y: 3.5 }, 0.25),
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
    jail: jitter({ x: 0, y: 0 }, 0.25),
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
    storageCenters: [jitter({ x: 18, y: -15 }, 0.35), jitter({ x: 26, y: 0 }, 0.35), jitter({ x: 10, y: 15 }, 0.35)],
    jail: jitter({ x: 0, y: 16 }, 0.25),
    obstacleCenters: [
      { center: { x: -16, y: -15 }, half: { x: 1.5, y: 0.6 } }, { center: { x: 4, y: -16 }, half: { x: 1.5, y: 0.6 } },
      { center: { x: -5, y: 16 }, half: { x: 1.4, y: 0.6 } }, { center: { x: 14, y: 14 }, half: { x: 1.2, y: 0.6 } }
    ]
  };
  if (kind === 'CROSS') return {
    kind,
    playableArea: [
      { x: -11, y: -23 }, { x: 11, y: -23 }, { x: 11, y: -9 }, { x: 31, y: -9 },
      { x: 31, y: 9 }, { x: 11, y: 9 }, { x: 11, y: 23 }, { x: -11, y: 23 },
      { x: -11, y: 9 }, { x: -31, y: 9 }, { x: -31, y: -9 }, { x: -11, y: -9 }
    ],
    playableHoles: [], thiefBase: jitter({ x: -25, y: 0 }),
    storageCenters: [jitter({ x: 0, y: -18 }), jitter({ x: 25, y: 0 }), jitter({ x: 0, y: 18 })],
    jail: jitter({ x: 0, y: 0 }, 0.25),
    obstacleCenters: [
      { center: { x: -14, y: -5 }, half: { x: 1.4, y: 0.6 } }, { center: { x: -5, y: 13 }, half: { x: 0.6, y: 1.5 } },
      { center: { x: 5, y: -13 }, half: { x: 0.6, y: 1.5 } }, { center: { x: 15, y: 5 }, half: { x: 1.4, y: 0.6 } }
    ]
  };
  if (kind === 'DIAMOND') return {
    kind,
    playableArea: [
      { x: 0, y: -23 }, { x: 18, y: -19 }, { x: 31, y: 0 }, { x: 18, y: 19 },
      { x: 0, y: 23 }, { x: -18, y: 19 }, { x: -31, y: 0 }, { x: -18, y: -19 }
    ],
    playableHoles: [], thiefBase: jitter({ x: -25, y: 0 }),
    storageCenters: [jitter({ x: 9, y: -15 }), jitter({ x: 25, y: 0 }), jitter({ x: 9, y: 15 })],
    jail: jitter({ x: 0, y: 0 }, 0.25),
    obstacleCenters: [
      { center: { x: -12, y: -10 }, half: { x: 1.5, y: 0.6 } }, { center: { x: -8, y: 9 }, half: { x: 0.6, y: 1.6 } },
      { center: { x: 6, y: -8 }, half: { x: 0.6, y: 1.7 } }, { center: { x: 14, y: 9 }, half: { x: 1.6, y: 0.6 } }
    ]
  };
  if (kind === 'COURTYARD') return {
    kind,
    playableArea: [{ x: -29, y: -22 }, { x: 29, y: -22 }, { x: 32, y: -17 }, { x: 32, y: 17 }, { x: 29, y: 22 }, { x: -29, y: 22 }, { x: -32, y: 17 }, { x: -32, y: -17 }],
    playableHoles: [
      [{ x: -9, y: -7 }, { x: -2, y: -7 }, { x: -2, y: 7 }, { x: -9, y: 7 }],
      [{ x: 3, y: -7 }, { x: 10, y: -7 }, { x: 10, y: 7 }, { x: 3, y: 7 }]
    ],
    thiefBase: jitter({ x: -25, y: 0 }),
    storageCenters: [jitter({ x: 16, y: -15 }), jitter({ x: 26, y: 0 }), jitter({ x: 16, y: 15 })],
    jail: jitter({ x: 0, y: 16 }),
    obstacleCenters: [
      { center: { x: -17, y: -13 }, half: { x: 1.5, y: 0.6 } }, { center: { x: -18, y: 12 }, half: { x: 0.6, y: 1.5 } },
      { center: { x: 15, y: -8 }, half: { x: 0.6, y: 1.5 } }, { center: { x: 18, y: 8 }, half: { x: 1.5, y: 0.6 } }
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
    storageCenters: [jitter({ x: 11, y: -14 }), jitter({ x: 25, y: 0 }), jitter({ x: 17, y: 14 })],
    jail: jitter({ x: 0, y: 16 }),
    obstacleCenters: [
      { center: { x: -14, y: -10 }, half: { x: 1.5, y: 0.7 } }, { center: { x: -13, y: 10 }, half: { x: 0.7, y: 1.6 } },
      { center: { x: -5, y: -5 }, half: { x: 0.7, y: 1.8 } }, { center: { x: 3, y: 7 }, half: { x: 1.8, y: 0.7 } },
      { center: { x: 9, y: -10 }, half: { x: 1.6, y: 0.7 } }, { center: { x: 12, y: 5 }, half: { x: 0.7, y: 1.6 } }
    ]
  };
}

/** 지형 외곽과 거점·장애물 간격을 거시 배율로 확장하되 개별 prefab 크기는 별도 balance로 유지한다. */
function scaleLayout(layout: LayoutTemplate): LayoutTemplate {
  const point = (value: Vec2): Vec2 => ({ x: value.x * mapScale, y: value.y * mapScale });
  const obstacleHalf = (half: Vec2): Vec2 => {
    const horizontal = half.x >= half.y;
    return {
      x: half.x * (horizontal ? 2.4 : 1.35),
      y: half.y * (horizontal ? 1.35 : 2.4)
    };
  };
  return {
    ...layout,
    playableArea: layout.playableArea.map(point),
    playableHoles: layout.playableHoles.map((hole) => hole.map(point)),
    thiefBase: point(layout.thiefBase),
    storageCenters: layout.storageCenters.map(point),
    jail: point(layout.jail),
    obstacleCenters: layout.obstacleCenters.map((obstacle) => ({ center: point(obstacle.center), half: obstacleHalf(obstacle.half) }))
  };
}

const zoneClear = (point: Vec2, zones: ZoneDefinition[], padding: number): boolean =>
  zones.every((zone) => distanceSquared(point, zone.center) > (zone.radius + padding) ** 2);

/** 어떤 두 거점에도 적용 가능한 단일 완만한 곡선 경로를 만들어 edge별 좌표 가정을 없앤다. */
function route(_kind: MapLayoutKind, from: Vec2, to: Vec2, lane = 1): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return [from, to];
  const bend = Math.min(12, distance * 0.12) * lane;
  return [
    from,
    { x: (from.x + to.x) / 2 - dy / distance * bend, y: (from.y + to.y) / 2 + dx / distance * bend },
    to
  ];
}

/** 하나의 파생 seed에서 layout·장애물·나무·아이템 후보를 결정론적으로 생성한다. */
function makeRawMap(seed: string): MapDefinition {
  const random = new SeededRandom(seed);
  const kinds: MapLayoutKind[] = ['LINE', 'H', 'RING', 'GRAPH', 'CROSS', 'DIAMOND', 'COURTYARD'];
  const layout = scaleLayout(createBaseLayout(kinds[random.integer(0, kinds.length)]!, random));
  const thiefBase: ZoneDefinition = { id: 'thief-base', center: layout.thiefBase, radius: 3 };
  const storages: StorageDefinition[] = layout.storageCenters.map((center, index) => ({
    id: `storage-${index}` as StorageDefinition['id'], center, radius: 2.2,
    slotPositions: [-0.72, 0, 0.72].map((offset) => ({ x: center.x, y: center.y + offset }))
  }));
  const jailCenter = layout.jail;
  const jailRadius = 2.6;
  const escapeDistance = jailRadius + gameBalance.playerRadius + 0.8;
  const jail = {
    id: 'jail', center: jailCenter, radius: jailRadius,
    slots: [-1.05, -0.35, 0.35, 1.05].map((offset) => ({ x: jailCenter.x + offset, y: jailCenter.y })),
    escapePoints: [
      { x: jailCenter.x, y: jailCenter.y - escapeDistance }, { x: jailCenter.x, y: jailCenter.y + escapeDistance },
      { x: jailCenter.x - escapeDistance, y: jailCenter.y }, { x: jailCenter.x + escapeDistance, y: jailCenter.y }
    ]
  };
  const policeSpawnDistance = jail.radius + gameBalance.playerRadius + gameBalance.policeSpawnRadius + 0.65;
  const policeSpawns = [
    { x: jailCenter.x, y: jailCenter.y - policeSpawnDistance },
    { x: jailCenter.x, y: jailCenter.y + policeSpawnDistance },
    { x: jailCenter.x - policeSpawnDistance, y: jailCenter.y },
    { x: jailCenter.x + policeSpawnDistance, y: jailCenter.y }
  ];
  const thiefSpawns = Array.from({ length: gameBalance.teamSize }, () => ({ ...thiefBase.center }));
  const spawnZones: ZoneDefinition[] = [
    { id: 'thief-spawn', center: thiefBase.center, radius: gameBalance.playerSpawnRadius + gameBalance.playerRadius },
    ...policeSpawns.map((center, index) => ({ id: `police-spawn-${index}`, center, radius: gameBalance.policeSpawnRadius + gameBalance.playerRadius }))
  ];
  const protectedZones: ZoneDefinition[] = [thiefBase, jail, ...storages, ...spawnZones];
  // 모든 거점을 독립적으로 기지에 잇지 않고, 거리 기반 최소 연결망으로 하나의 주 경로 graph를 만든다.
  // 각 edge는 두 거점 중심에서 정확히 시작·종료하므로 렌더러의 접합부와 game landmark가 어긋나지 않는다.
  const routeNodes = [
    { id: thiefBase.id, center: thiefBase.center }, { id: jail.id, center: jail.center },
    ...storages.map((storage) => ({ id: storage.id, center: storage.center }))
  ];
  const connected = [routeNodes[0]!];
  const pending = routeNodes.slice(1);
  const paths: PathMetadata[] = [];
  while (pending.length > 0) {
    const choice = connected.flatMap((from) => pending.map((to) => ({ from, to, distance: distanceSquared(from.center, to.center) })))
      .sort((first, second) => first.distance - second.distance || first.from.id.localeCompare(second.from.id) || first.to.id.localeCompare(second.to.id))[0]!;
    const lane = choice.from.id.localeCompare(choice.to.id) <= 0 ? 1 : -1;
    const points = route(layout.kind, choice.from.center, choice.to.center, lane);
    paths.push({ from: choice.from.id, to: choice.to.id, points, length: pathLength(points) });
    connected.push(choice.to);
    pending.splice(pending.indexOf(choice.to), 1);
  }
  const dirtPaths: DirtPathDefinition[] = paths.map((path) => ({ id: `dirt:${path.from}:${path.to}`, points: path.points.map((point) => ({ ...point })), width: 2.15 }));
  const staticColliders: Aabb[] = [];
  for (const template of layout.obstacleCenters) {
    const center = { x: template.center.x + random.range(-2, 2), y: template.center.y + random.range(-2, 2) };
    if (!zoneClear(center, protectedZones, Math.max(template.half.x, template.half.y) + 0.8)) continue;
    const candidate = { min: { x: center.x - template.half.x, y: center.y - template.half.y }, max: { x: center.x + template.half.x, y: center.y + template.half.y } };
    const corners = [candidate.min, candidate.max, { x: candidate.min.x, y: candidate.max.y }, { x: candidate.max.x, y: candidate.min.y }];
    if (corners.every((point) => isCircleInPlayableArea(point, 0.25, bounds, layout.playableArea, layout.playableHoles))) staticColliders.push(candidate);
  }

  const trees: TreeDefinition[] = [];
  for (let attempt = 0; trees.length < gameBalance.treeTarget && attempt < 4_000; attempt += 1) {
    const trunkRadius = random.range(0.46, 0.64);
    const canopyRadius = random.range(2.05, 2.65);
    const center = { x: random.range(bounds.min.x + 5, bounds.max.x - 5), y: random.range(bounds.min.y + 5, bounds.max.y - 5) };
    if (!isCircleInPlayableArea(center, canopyRadius, bounds, layout.playableArea, layout.playableHoles) ||
      !zoneClear(center, protectedZones, canopyRadius + 0.7) ||
      staticColliders.some((box) => circleIntersectsAabb(center, canopyRadius + 0.35, box)) ||
      trees.some((tree) => circleIntersectsCircle(center, canopyRadius + 0.6, tree.center, tree.canopyRadius))) continue;
    trees.push({ id: `tree-${trees.length}`, center, trunkRadius, canopyRadius });
  }

  const rockPiles: RockPileDefinition[] = [];
  const bushes: BushDefinition[] = [];
  const decorationChunks = terrainChunks(layout)
    .map((chunk) => ({ chunk, priority: new SeededRandom(`${seed}:chunk-priority:${chunk.column}:${chunk.row}`).next() }))
    .sort((first, second) => first.priority - second.priority)
    .map(({ chunk }) => chunk);
  const dirtPathClear = (center: Vec2, radius: number): boolean => dirtPaths.every((path) => path.points.slice(1).every((end, index) =>
    pointSegmentDistanceSquared(center, path.points[index]!, end) >= (radius + path.width / 2 + 0.35) ** 2
  ));
  const circleDecorationClear = (center: Vec2, radius: number): boolean =>
    isCircleInPlayableArea(center, radius, bounds, layout.playableArea, layout.playableHoles) &&
    zoneClear(center, protectedZones, radius + 1.1) &&
    !staticColliders.some((box) => circleIntersectsAabb(center, radius + 0.25, box)) &&
    !trees.some((tree) => circleIntersectsCircle(center, radius + 0.45, tree.center, tree.trunkRadius)) &&
    !rockPiles.some((rock) => circleIntersectsCircle(center, radius + 0.45, rock.center, rock.radius)) &&
    !bushes.some((bush) => circleIntersectsCircle(center, radius + 0.45, bush.center, bush.radius)) &&
    dirtPathClear(center, radius);
  const placeChunkObstacles = (kind: 'rock' | 'bush', target: number): void => {
    for (const chunk of decorationChunks) {
      if ((kind === 'rock' ? rockPiles : bushes).length >= target) break;
      const chunkRandom = new SeededRandom(`${seed}:${kind}:${chunk.column}:${chunk.row}`);
      const radius = kind === 'rock' ? chunkRandom.range(0.65, 0.95) : chunkRandom.range(0.8, 1.18);
      const center = {
        x: chunk.center.x + chunkRandom.range(-3.75, 3.75),
        y: chunk.center.y + chunkRandom.range(-3.75, 3.75)
      };
      if (!circleDecorationClear(center, radius)) continue;
      if (kind === 'rock') rockPiles.push({ id: `rock-${rockPiles.length}`, center, radius });
      else bushes.push({ id: `bush-${bushes.length}`, center, radius });
    }
  };
  placeChunkObstacles('rock', gameBalance.rockPileTarget);
  placeChunkObstacles('bush', gameBalance.bushTarget);

  const berrySpawnPoints: Vec2[] = [];
  for (let attempt = 0; berrySpawnPoints.length < gameBalance.berrySpawnPointTarget && attempt < 8_000; attempt += 1) {
    const point = { x: random.range(bounds.min.x + 4, bounds.max.x - 4), y: random.range(bounds.min.y + 4, bounds.max.y - 4) };
    const clearance = gameBalance.berryPickupRadius + gameBalance.berrySpawnRadius;
    const valid = isCircleInPlayableArea(point, clearance, bounds, layout.playableArea, layout.playableHoles) &&
      !staticColliders.some((box) => circleIntersectsAabb(point, clearance, box)) &&
      !trees.some((tree) => circleIntersectsCircle(point, clearance, tree.center, tree.trunkRadius)) &&
      !rockPiles.some((rock) => circleIntersectsCircle(point, clearance, rock.center, rock.radius)) &&
      !bushes.some((bush) => circleIntersectsCircle(point, clearance, bush.center, bush.radius)) &&
      zoneClear(point, protectedZones, clearance) && berrySpawnPoints.every((existing) => distanceSquared(point, existing) >= gameBalance.berrySpawnPointMinSeparation ** 2);
    if (valid) berrySpawnPoints.push(point);
  }

  const mapWithoutHash = {
    id: `map-${seed}`, seed, generatorVersion, balanceVersion, layoutKind: layout.kind, width, height, bounds,
    playableArea: layout.playableArea, playableHoles: layout.playableHoles,
    teamSpawns: {
      THIEF: thiefSpawns,
      POLICE: policeSpawns
    },
    thiefBase, jail, storages, staticColliders, occluders: staticColliders, trees, rockPiles, bushes, paths, dirtPaths, berrySpawnPoints,
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
