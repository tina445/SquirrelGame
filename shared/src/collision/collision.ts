import type { Aabb, MapDefinition, Vec2 } from '../domain/types.js';
import { add, scale, subtract } from '../math/vector.js';

export interface CircleCollider { center: Vec2; radius: number }

/** MapDefinition의 나무 줄기와 감옥 프리팹 경계를 서버·예측이 공유하는 이동 충돌체 목록으로 변환한다. */
export function movementCircleColliders(map: Pick<MapDefinition, 'jail' | 'trees'>): CircleCollider[] {
  return [
    { center: map.jail.center, radius: map.jail.radius },
    ...map.trees.map((tree) => ({ center: tree.center, radius: tree.trunkRadius }))
  ];
}

/** 원형 프리팹의 외곽에서 주어진 상호작용 거리 안인지 판정해 내부 중심점 접근을 요구하지 않게 한다. */
export function isWithinCircleReach(point: Vec2, collider: CircleCollider, reach: number): boolean {
  const radius = collider.radius + reach;
  return (point.x - collider.center.x) ** 2 + (point.y - collider.center.y) ** 2 <= radius * radius;
}

/** 원형 엔티티와 축 정렬 장애물의 엄격한 겹침을 판정한다. 접점만 닿은 상태는 이동 가능하다. */
export function circleIntersectsAabb(center: Vec2, radius: number, box: Aabb): boolean {
  const x = Math.max(box.min.x, Math.min(center.x, box.max.x));
  const y = Math.max(box.min.y, Math.min(center.y, box.max.y));
  const dx = center.x - x;
  const dy = center.y - y;
  return dx * dx + dy * dy < radius * radius;
}

/** 두 원의 내부가 겹치는지 판정해 나무 줄기와 원형 엔티티 충돌에 공유한다. */
export function circleIntersectsCircle(a: Vec2, aRadius: number, b: Vec2, bRadius: number): boolean {
  const combined = aRadius + bRadius;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < combined * combined;
}

/** 원형 엔티티 전체가 맵 경계 안에 들어오는지 확인한다. */
export function isCircleInBounds(center: Vec2, radius: number, bounds: Aabb): boolean {
  return center.x - radius >= bounds.min.x && center.x + radius <= bounds.max.x &&
    center.y - radius >= bounds.min.y && center.y + radius <= bounds.max.y;
}

/** 점이 다각형 안에 있는지 ray crossing으로 판정하며 맵 외곽 표현과 충돌이 같은 꼭짓점을 사용하게 한다. */
export function isPointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]!;
    const b = polygon[previous]!;
    const crosses = (a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** 원 중심이 다각형 안에 있고 모든 변에서 반지름 이상 떨어져 있는지 검사한다. */
export function isCircleInPolygon(center: Vec2, radius: number, polygon: Vec2[]): boolean {
  if (polygon.length < 3 || !isPointInPolygon(center, polygon)) return false;
  const radiusSquared = radius * radius;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / lengthSquared));
    const nearestX = a.x + dx * amount;
    const nearestY = a.y + dy * amount;
    if ((center.x - nearestX) ** 2 + (center.y - nearestY) ** 2 < radiusSquared) return false;
  }
  return true;
}

/** 원이 비이동 polygon hole의 내부와 경계에서 모두 반지름만큼 벗어났는지 검사한다. */
export function isCircleOutsidePolygon(center: Vec2, radius: number, polygon: Vec2[]): boolean {
  if (polygon.length < 3 || isPointInPolygon(center, polygon)) return false;
  const radiusSquared = radius * radius;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / lengthSquared));
    const nearestX = a.x + dx * amount;
    const nearestY = a.y + dy * amount;
    if ((center.x - nearestX) ** 2 + (center.y - nearestY) ** 2 < radiusSquared) return false;
  }
  return true;
}

/** 다각형이 있으면 불규칙 플레이 영역을, 없으면 이전 직사각형 경계를 사용하는 호환 판정이다. */
export function isCircleInPlayableArea(center: Vec2, radius: number, bounds: Aabb, playableArea?: Vec2[], playableHoles: Vec2[][] = []): boolean {
  return (playableArea ? isCircleInPolygon(center, radius, playableArea) : isCircleInBounds(center, radius, bounds)) &&
    playableHoles.every((hole) => isCircleOutsidePolygon(center, radius, hole));
}

/** X축과 Y축을 순서대로 해결해 벽을 따라 미끄러지는 공유 이동 결과를 만든다. */
export function moveCircle(position: Vec2, delta: Vec2, radius: number, bounds: Aabb, colliders: Aabb[], playableArea?: Vec2[], playableHoles: Vec2[][] = [], circleColliders: CircleCollider[] = []): Vec2 {
  const result = { ...position };
  const xCandidate = { x: result.x + delta.x, y: result.y };
  if (isCircleInPlayableArea(xCandidate, radius, bounds, playableArea, playableHoles) && !colliders.some((box) => circleIntersectsAabb(xCandidate, radius, box)) && !circleColliders.some((circle) => circleIntersectsCircle(xCandidate, radius, circle.center, circle.radius))) result.x = xCandidate.x;
  const yCandidate = { x: result.x, y: result.y + delta.y };
  if (isCircleInPlayableArea(yCandidate, radius, bounds, playableArea, playableHoles) && !colliders.some((box) => circleIntersectsAabb(yCandidate, radius, box)) && !circleColliders.some((circle) => circleIntersectsCircle(yCandidate, radius, circle.center, circle.radius))) result.y = yCandidate.y;
  return result;
}

/** 선분이 장애물과 만나는지 hit fraction 계산을 통해 판정한다. */
export function segmentIntersectsAabb(start: Vec2, end: Vec2, box: Aabb): boolean {
  return segmentAabbHitFraction(start, end, box) !== null;
}

/** 선분상 첫 AABB 충돌 위치를 0..1 비율로 반환해 투사체의 최초 충돌 순서를 결정한다. */
export function segmentAabbHitFraction(start: Vec2, end: Vec2, box: Aabb): number | null {
  const direction = subtract(end, start);
  let near = 0;
  let far = 1;
  for (const axis of ['x', 'y'] as const) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return null;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (box.min[axis] - start[axis]) * inverse;
    let second = (box.max[axis] - start[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  return near;
}

/** 선분과 원형 충돌체가 처음 만나는 0..1 비율을 반환한다. */
export function segmentCircleHitFraction(start: Vec2, end: Vec2, center: Vec2, radius: number): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a === 0 || discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}

/** 선분과 polygon 경계선의 가장 이른 교차 비율을 반환해 hitscan이 외곽과 hole을 관통하지 않게 한다. */
export function segmentPolygonBoundaryHitFraction(start: Vec2, end: Vec2, polygon: Vec2[]): number | null {
  const ray = subtract(end, start);
  let closest: number | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]!;
    const b = polygon[(index + 1) % polygon.length]!;
    const edge = subtract(b, a);
    const denominator = ray.x * edge.y - ray.y * edge.x;
    if (Math.abs(denominator) < 1e-9) continue;
    const offset = subtract(a, start);
    const rayFraction = (offset.x * edge.y - offset.y * edge.x) / denominator;
    const edgeFraction = (offset.x * ray.y - offset.y * ray.x) / denominator;
    if (rayFraction < 0 || rayFraction > 1 || edgeFraction < 0 || edgeFraction > 1) continue;
    if (closest === null || rayFraction < closest) closest = rayFraction;
  }
  return closest;
}

/** 체포 등 범위 행동에서 두 지점 사이를 막는 정적 장애물이 없는지 확인한다. */
export function lineOfSight(a: Vec2, b: Vec2, blockers: Aabb[], circleBlockers: CircleCollider[] = []): boolean {
  return !blockers.some((box) => segmentIntersectsAabb(a, b, box)) && !circleBlockers.some((circle) => segmentCircleHitFraction(a, b, circle.center, circle.radius) !== null);
}

/** 도토리 낙하 지점부터 동심원으로 탐색해 가장 가까운 유효 위치를 제한된 비용으로 찾는다. */
export function findNearestValidPosition(origin: Vec2, radius: number, bounds: Aabb, colliders: Aabb[], playableArea?: Vec2[], playableHoles: Vec2[][] = [], circleColliders: CircleCollider[] = []): Vec2 | null {
  const step = radius * 0.75;
  for (let ring = 0; ring <= 12; ring += 1) {
    const samples = Math.max(1, ring * 8);
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const candidate = add(origin, scale({ x: Math.cos(angle), y: Math.sin(angle) }, ring * step));
      if (isCircleInPlayableArea(candidate, radius, bounds, playableArea, playableHoles) && !colliders.some((box) => circleIntersectsAabb(candidate, radius, box)) && !circleColliders.some((circle) => circleIntersectsCircle(candidate, radius, circle.center, circle.radius))) return candidate;
    }
  }
  return null;
}
