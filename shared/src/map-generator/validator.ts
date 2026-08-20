import { circleIntersectsAabb, isCircleInBounds } from '../collision/collision.js';
import { gameBalance } from '../config/gameBalance.js';
import type { MapDefinition, Vec2 } from '../domain/types.js';

export interface MapValidation { valid: boolean; errors: string[] }

function canReach(map: MapDefinition, start: Vec2, goal: Vec2): boolean {
  const cell = 1;
  const cols = Math.floor(map.width / cell);
  const rows = Math.floor(map.height / cell);
  const toGrid = (point: Vec2): [number, number] => [Math.floor(point.x - map.bounds.min.x), Math.floor(point.y - map.bounds.min.y)];
  const [startX, startY] = toGrid(start);
  const [goalX, goalY] = toGrid(goal);
  const queue: Array<[number, number]> = [[startX, startY]];
  const visited = new Set([`${startX},${startY}`]);
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (Math.abs(x - goalX) <= 1 && Math.abs(y - goalY) <= 1) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      const point = { x: map.bounds.min.x + nx + 0.5, y: map.bounds.min.y + ny + 0.5 };
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || visited.has(key) ||
        !isCircleInBounds(point, gameBalance.playerRadius, map.bounds) ||
        map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box))) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

export function validateMap(map: MapDefinition): MapValidation {
  const errors: string[] = [];
  if (map.storages.length !== gameBalance.storageCount) errors.push('exactly three storages required');
  if (map.berrySpawnPoints.length < 8) errors.push('at least eight berry points required');
  if (map.jail.escapePoints.length < 4) errors.push('at least four escape points required');
  const anchors = [map.thiefBase, map.jail, ...map.storages];
  for (const anchor of anchors) {
    if (!isCircleInBounds(anchor.center, anchor.radius, map.bounds)) errors.push(`${anchor.id} outside bounds`);
    if (map.staticColliders.some((box) => circleIntersectsAabb(anchor.center, anchor.radius, box))) errors.push(`${anchor.id} overlaps collider`);
  }
  for (const point of [...map.berrySpawnPoints, ...map.jail.escapePoints]) {
    if (!isCircleInBounds(point, gameBalance.playerRadius, map.bounds) || map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box))) errors.push('candidate point blocked');
  }
  const targets = [...map.storages.map((storage) => storage.center), map.jail.center, map.thiefBase.center];
  for (const spawn of [...map.teamSpawns.THIEF, ...map.teamSpawns.POLICE]) {
    for (const target of targets) if (!canReach(map, spawn, target)) errors.push('anchor is unreachable from team spawn');
  }
  if (map.staticColliders.length > 80) errors.push('static collider budget exceeded');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
