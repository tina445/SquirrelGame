import type { Aabb, Vec2 } from '../domain/types.js';
import { add, scale, subtract } from '../math/vector.js';

/** 원형 엔티티와 축 정렬 장애물의 엄격한 겹침을 판정한다. 접점만 닿은 상태는 이동 가능하다. */
export function circleIntersectsAabb(center: Vec2, radius: number, box: Aabb): boolean {
  const x = Math.max(box.min.x, Math.min(center.x, box.max.x));
  const y = Math.max(box.min.y, Math.min(center.y, box.max.y));
  const dx = center.x - x;
  const dy = center.y - y;
  return dx * dx + dy * dy < radius * radius;
}

/** 원형 엔티티 전체가 맵 경계 안에 들어오는지 확인한다. */
export function isCircleInBounds(center: Vec2, radius: number, bounds: Aabb): boolean {
  return center.x - radius >= bounds.min.x && center.x + radius <= bounds.max.x &&
    center.y - radius >= bounds.min.y && center.y + radius <= bounds.max.y;
}

/** X축과 Y축을 순서대로 해결해 벽을 따라 미끄러지는 공유 이동 결과를 만든다. */
export function moveCircle(position: Vec2, delta: Vec2, radius: number, bounds: Aabb, colliders: Aabb[]): Vec2 {
  const result = { ...position };
  const xCandidate = { x: result.x + delta.x, y: result.y };
  if (isCircleInBounds(xCandidate, radius, bounds) && !colliders.some((box) => circleIntersectsAabb(xCandidate, radius, box))) result.x = xCandidate.x;
  const yCandidate = { x: result.x, y: result.y + delta.y };
  if (isCircleInBounds(yCandidate, radius, bounds) && !colliders.some((box) => circleIntersectsAabb(yCandidate, radius, box))) result.y = yCandidate.y;
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

/** 체포 등 범위 행동에서 두 지점 사이를 막는 정적 장애물이 없는지 확인한다. */
export function lineOfSight(a: Vec2, b: Vec2, blockers: Aabb[]): boolean {
  return !blockers.some((box) => segmentIntersectsAabb(a, b, box));
}

/** 도토리 낙하 지점부터 동심원으로 탐색해 가장 가까운 유효 위치를 제한된 비용으로 찾는다. */
export function findNearestValidPosition(origin: Vec2, radius: number, bounds: Aabb, colliders: Aabb[]): Vec2 | null {
  const step = radius * 0.75;
  for (let ring = 0; ring <= 12; ring += 1) {
    const samples = Math.max(1, ring * 8);
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      const candidate = add(origin, scale({ x: Math.cos(angle), y: Math.sin(angle) }, ring * step));
      if (isCircleInBounds(candidate, radius, bounds) && !colliders.some((box) => circleIntersectsAabb(candidate, radius, box))) return candidate;
    }
  }
  return null;
}
