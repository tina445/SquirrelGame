import {
  circleIntersectsAabb, circleIntersectsCircle, gameBalance, isCircleInPlayableArea, movementCircleColliders,
  normalize, subtract, type MapDefinition, type Vec2
} from '@squirrel-heist/shared';

interface Cell { x: number; y: number }
interface Grid { cellSize: number; cols: number; rows: number; valid: Set<string> }

const key = (cell: Cell): string => `${cell.x},${cell.y}`;

export class BotNavigator {
  private gridHash = '';
  private grid: Grid | null = null;
  private path: Vec2[] = [];
  private pathIndex = 0;
  private targetKey = '';
  private lastStart: Vec2 | null = null;
  private stalledDecisions = 0;

  /** 맵 충돌 규칙으로 grid를 한 번 만들고 목표가 바뀔 때만 A* 경로를 다시 계산한다. */
  direction(map: MapDefinition, start: Vec2, target: Vec2, targetId: string): Vec2 {
    if (!this.grid || this.gridHash !== map.hash) {
      this.grid = this.buildGrid(map);
      this.gridHash = map.hash;
      this.path = [];
    }
    if (this.lastStart && this.distanceSquared(this.lastStart, start) < 0.2 ** 2) this.stalledDecisions += 1;
    else this.stalledDecisions = 0;
    this.lastStart = { ...start };
    if (this.stalledDecisions >= 4) {
      this.path = [];
      this.targetKey = '';
      this.stalledDecisions = 0;
    }
    if (this.targetKey !== targetId || this.path.length === 0 || this.pathIndex >= this.path.length) {
      this.path = this.findPath(map, this.grid, start, target);
      this.pathIndex = 0;
      this.targetKey = targetId;
    }
    while (this.pathIndex < this.path.length - 1 && this.distanceSquared(start, this.path[this.pathIndex]!) < this.grid.cellSize ** 2) this.pathIndex += 1;
    return normalize(subtract(this.path[this.pathIndex] ?? target, start));
  }

  private buildGrid(map: MapDefinition): Grid {
    const cellSize = Math.max(2, map.width / 64);
    const cols = Math.floor(map.width / cellSize);
    const rows = Math.floor(map.height / cellSize);
    const valid = new Set<string>();
    const circles = movementCircleColliders(map);
    for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
      const point = this.point(map, { x, y }, cellSize);
      if (this.isValidPoint(map, point, circles)) valid.add(key({ x, y }));
    }
    return { cellSize, cols, rows, valid };
  }

  private findPath(map: MapDefinition, grid: Grid, start: Vec2, target: Vec2): Vec2[] {
    const startCell = this.nearestValid(map, grid, start);
    const targetCell = this.nearestValid(map, grid, target);
    if (!startCell || !targetCell) return [target];
    const open = new Set([key(startCell)]);
    const cells = new Map([[key(startCell), startCell], [key(targetCell), targetCell]]);
    const cameFrom = new Map<string, string>();
    const cost = new Map([[key(startCell), 0]]);
    const estimate = new Map([[key(startCell), this.cellDistance(startCell, targetCell)]]);
    const circles = movementCircleColliders(map);
    const directions = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: dx, y: dy }))).filter((item) => item.x !== 0 || item.y !== 0);
    while (open.size > 0) {
      const currentKey = [...open].sort((a, b) => (estimate.get(a) ?? Infinity) - (estimate.get(b) ?? Infinity))[0]!;
      const current = cells.get(currentKey)!;
      if (currentKey === key(targetCell)) {
        const result: Cell[] = [current];
        let cursor = currentKey;
        while (cameFrom.has(cursor)) { cursor = cameFrom.get(cursor)!; result.push(cells.get(cursor)!); }
        result.reverse();
        return [...result.map((cell) => this.point(map, cell, grid.cellSize)), target];
      }
      open.delete(currentKey);
      for (const direction of directions) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        const nextKey = key(next);
        if (!grid.valid.has(nextKey)) continue;
        if (direction.x !== 0 && direction.y !== 0 &&
          (!grid.valid.has(key({ x: current.x + direction.x, y: current.y })) ||
            !grid.valid.has(key({ x: current.x, y: current.y + direction.y })))) continue;
        const from = this.point(map, current, grid.cellSize);
        const to = this.point(map, next, grid.cellSize);
        if (![0.25, 0.5, 0.75].every((amount) => this.isValidPoint(map, {
          x: from.x + (to.x - from.x) * amount,
          y: from.y + (to.y - from.y) * amount
        }, circles))) continue;
        cells.set(nextKey, next);
        const nextCost = (cost.get(currentKey) ?? Infinity) + (direction.x !== 0 && direction.y !== 0 ? Math.SQRT2 : 1);
        if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
        cameFrom.set(nextKey, currentKey);
        cost.set(nextKey, nextCost);
        estimate.set(nextKey, nextCost + this.cellDistance(next, targetCell));
        open.add(nextKey);
      }
    }
    return [target];
  }

  private nearestValid(map: MapDefinition, grid: Grid, point: Vec2): Cell | null {
    const base = { x: Math.floor((point.x - map.bounds.min.x) / grid.cellSize), y: Math.floor((point.y - map.bounds.min.y) / grid.cellSize) };
    for (let radius = 0; radius <= 4; radius += 1) for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) {
      const candidate = { x: base.x + x, y: base.y + y };
      if (grid.valid.has(key(candidate))) return candidate;
    }
    return null;
  }

  private point(map: MapDefinition, cell: Cell, cellSize: number): Vec2 {
    return { x: map.bounds.min.x + (cell.x + 0.5) * cellSize, y: map.bounds.min.y + (cell.y + 0.5) * cellSize };
  }
  private isValidPoint(map: MapDefinition, point: Vec2, circles = movementCircleColliders(map)): boolean {
    return isCircleInPlayableArea(point, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles) &&
      !map.staticColliders.some((box) => circleIntersectsAabb(point, gameBalance.playerRadius, box)) &&
      !circles.some((circle) => circleIntersectsCircle(point, gameBalance.playerRadius, circle.center, circle.radius));
  }
  private cellDistance(a: Cell, b: Cell): number { return Math.hypot(a.x - b.x, a.y - b.y); }
  private distanceSquared(a: Vec2, b: Vec2): number { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
}
