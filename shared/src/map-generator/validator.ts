import { circleIntersectsAabb, circleIntersectsCircle, isCircleInPlayableArea } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { MapDefinition, Vec2 } from '../domain/types.js';

export interface MapValidation { valid: boolean; errors: string[] }

/** 맵 거시 배율에 맞춘 grid에서 첫 도둑 스폰부터 주요 거점까지의 이동 가능성을 flood-fill한다. */
function reachableCells(map: MapDefinition, start: Vec2): Set<string> {
  const cell = Math.max(1, map.width / 64);
  const cols = Math.floor(map.width / cell);
  const rows = Math.floor(map.height / cell);
  const toGrid = (point: Vec2): [number, number] => [Math.floor((point.x - map.bounds.min.x) / cell), Math.floor((point.y - map.bounds.min.y) / cell)];
  const [startX, startY] = toGrid(start);
  const startCandidates = [0, -1, 1].flatMap((dx) => [0, -1, 1].map((dy) => [startX + dx, startY + dy] as [number, number]));
  const initial = startCandidates.find(([x, y]) => {
    const point = { x: map.bounds.min.x + (x + 0.5) * cell, y: map.bounds.min.y + (y + 0.5) * cell };
    return x >= 0 && y >= 0 && x < cols && y < rows && isCircleInPlayableArea(point, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles) &&
      !map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box)) &&
      !map.trees.some((tree) => circleIntersectsCircle(point, gameBalance.playerRadius, tree.center, tree.trunkRadius));
  });
  if (!initial) return new Set();
  const queue: Array<[number, number]> = [initial];
  const visited = new Set([`${initial[0]},${initial[1]}`]);
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      const point = { x: map.bounds.min.x + (nx + 0.5) * cell, y: map.bounds.min.y + (ny + 0.5) * cell };
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || visited.has(key) ||
        !isCircleInPlayableArea(point, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles) ||
        map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box)) ||
        map.trees.some((tree) => circleIntersectsCircle(point, gameBalance.playerRadius, tree.center, tree.trunkRadius))) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

/** 앵커 수·후보 안전성·연결성·장애물 예산을 검사해 플레이 불가능한 맵을 거부한다. */
export function validateMap(map: MapDefinition): MapValidation {
  const errors: string[] = [];
  if (!['LINE', 'H', 'RING', 'GRAPH', 'CROSS', 'DIAMOND', 'COURTYARD'].includes(map.layoutKind)) errors.push('unknown layout kind');
  if (map.playableArea.length < 6) errors.push('complex playable area required');
  const polygonArea = (polygon: Vec2[]): number => Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  const playableAreaSize = polygonArea(map.playableArea) - map.playableHoles.reduce((sum, hole) => sum + polygonArea(hole), 0);
  if (playableAreaSize < map.width * map.height * 0.28) errors.push('playable area is too small');
  if (map.layoutKind === 'RING' && map.playableHoles.length === 0) errors.push('ring layout requires a hole');
  if (map.storages.length !== gameBalance.storageCount) errors.push('exactly three storages required');
  if (map.berrySpawnPoints.length < 8) errors.push('at least eight berry points required');
  if (map.jail.escapePoints.length < 4) errors.push('at least four escape points required');
  const anchors = [map.thiefBase, map.jail, ...map.storages];
  for (const anchor of anchors) {
    if (!isCircleInPlayableArea(anchor.center, anchor.radius, map.bounds, map.playableArea, map.playableHoles)) errors.push(`${anchor.id} outside playable area`);
    if (map.staticColliders.some((box) => circleIntersectsAabb(anchor.center, anchor.radius, box))) errors.push(`${anchor.id} overlaps collider`);
    if (map.trees.some((tree) => circleIntersectsCircle(anchor.center, anchor.radius, tree.center, tree.trunkRadius))) errors.push(`${anchor.id} overlaps tree`);
  }
  for (const point of map.jail.escapePoints) {
    if (!isCircleInPlayableArea(point, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles) ||
      map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box)) ||
      map.trees.some((tree) => circleIntersectsCircle(point, gameBalance.playerRadius, tree.center, tree.trunkRadius))) errors.push('candidate point blocked');
  }
  for (const point of map.berrySpawnPoints) {
    const clearance = gameBalance.berryPickupRadius + gameBalance.berrySpawnRadius;
    if (!isCircleInPlayableArea(point, clearance, map.bounds, map.playableArea, map.playableHoles) ||
      map.staticColliders.some((box) => circleIntersectsAabb(point, clearance, box)) ||
      map.trees.some((tree) => circleIntersectsCircle(point, clearance, tree.center, tree.trunkRadius))) errors.push('berry spawn area blocked');
  }
  for (const spawn of [...map.teamSpawns.THIEF, ...map.teamSpawns.POLICE]) {
    const clearance = gameBalance.playerRadius + gameBalance.playerSpawnRadius;
    if (!isCircleInPlayableArea(spawn, clearance, map.bounds, map.playableArea, map.playableHoles) ||
      map.staticColliders.some((box) => circleIntersectsAabb(spawn, clearance, box)) ||
      map.trees.some((tree) => circleIntersectsCircle(spawn, clearance, tree.center, tree.trunkRadius))) errors.push('team spawn is blocked');
  }
  if (map.trees.length < 4) errors.push('at least four trees required');
  for (const tree of map.trees) {
    if (!(tree.trunkRadius > 0 && tree.canopyRadius > tree.trunkRadius)) errors.push('invalid tree radii');
    if (!isCircleInPlayableArea(tree.center, tree.canopyRadius, map.bounds, map.playableArea, map.playableHoles)) errors.push('tree canopy outside playable area');
  }
  const targets = [...map.teamSpawns.THIEF, ...map.teamSpawns.POLICE, ...map.storages.map((storage) => storage.center), map.jail.center, map.thiefBase.center];
  const reachable = reachableCells(map, map.teamSpawns.THIEF[0]!);
  const cell = Math.max(1, map.width / 64);
  for (const target of targets) {
      const targetX = Math.floor((target.x - map.bounds.min.x) / cell);
      const targetY = Math.floor((target.y - map.bounds.min.y) / cell);
      const nearby = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => reachable.has(`${targetX + dx},${targetY + dy}`)));
      if (!nearby) errors.push('spawn or anchor is unreachable');
  }
  if (map.staticColliders.length > 80) errors.push('static collider budget exceeded');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
