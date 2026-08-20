import { circleIntersectsAabb, isCircleInPolygon } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { MapDefinition, Vec2 } from '../domain/types.js';

export interface MapValidation { valid: boolean; errors: string[] }

/** 첫 도둑 스폰에서 플레이어 반지름을 고려한 이동 가능 grid를 한 번만 flood-fill한다. */
function reachableCells(map: MapDefinition, start: Vec2): Set<string> {
  const cell = 1;
  const cols = Math.floor(map.width / cell);
  const rows = Math.floor(map.height / cell);
  const toGrid = (point: Vec2): [number, number] => [Math.floor(point.x - map.bounds.min.x), Math.floor(point.y - map.bounds.min.y)];
  const [startX, startY] = toGrid(start);
  const startCandidates = [0, -1, 1].flatMap((dx) => [0, -1, 1].map((dy) => [startX + dx, startY + dy] as [number, number]));
  const initial = startCandidates.find(([x, y]) => {
    const point = { x: map.bounds.min.x + x + 0.5, y: map.bounds.min.y + y + 0.5 };
    return x >= 0 && y >= 0 && x < cols && y < rows && isCircleInPolygon(point, gameBalance.playerRadius, map.playableArea) &&
      !map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box));
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
      const point = { x: map.bounds.min.x + nx + 0.5, y: map.bounds.min.y + ny + 0.5 };
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || visited.has(key) ||
        !isCircleInPolygon(point, gameBalance.playerRadius, map.playableArea) ||
        map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box))) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return visited;
}

/** 앵커 수·후보 안전성·연결성·장애물 예산을 검사해 플레이 불가능한 맵을 거부한다. */
export function validateMap(map: MapDefinition): MapValidation {
  const errors: string[] = [];
  if (map.playableArea.length < 6) errors.push('complex playable area required');
  const signedArea = map.playableArea.reduce((sum, point, index) => {
    const next = map.playableArea[(index + 1) % map.playableArea.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  if (Math.abs(signedArea) < map.width * map.height * 0.6) errors.push('playable area is too small');
  if (map.storages.length !== gameBalance.storageCount) errors.push('exactly three storages required');
  if (map.berrySpawnPoints.length < 8) errors.push('at least eight berry points required');
  if (map.jail.escapePoints.length < 4) errors.push('at least four escape points required');
  const anchors = [map.thiefBase, map.jail, ...map.storages];
  for (const anchor of anchors) {
    if (!isCircleInPolygon(anchor.center, anchor.radius, map.playableArea)) errors.push(`${anchor.id} outside playable area`);
    if (map.staticColliders.some((box) => circleIntersectsAabb(anchor.center, anchor.radius, box))) errors.push(`${anchor.id} overlaps collider`);
  }
  for (const point of [...map.berrySpawnPoints, ...map.jail.escapePoints]) {
    if (!isCircleInPolygon(point, gameBalance.playerRadius, map.playableArea) || map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box))) errors.push('candidate point blocked');
  }
  for (const spawn of [...map.teamSpawns.THIEF, ...map.teamSpawns.POLICE]) {
    if (!isCircleInPolygon(spawn, gameBalance.playerRadius, map.playableArea) || map.staticColliders.some((box) => circleIntersectsAabb(spawn, gameBalance.playerRadius, box))) errors.push('team spawn is blocked');
  }
  const targets = [...map.teamSpawns.THIEF, ...map.teamSpawns.POLICE, ...map.storages.map((storage) => storage.center), map.jail.center, map.thiefBase.center];
  const reachable = reachableCells(map, map.teamSpawns.THIEF[0]!);
  for (const target of targets) {
      const targetX = Math.floor(target.x - map.bounds.min.x);
      const targetY = Math.floor(target.y - map.bounds.min.y);
      const nearby = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => reachable.has(`${targetX + dx},${targetY + dy}`)));
      if (!nearby) errors.push('spawn or anchor is unreachable');
  }
  if (map.staticColliders.length > 80) errors.push('static collider budget exceeded');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
