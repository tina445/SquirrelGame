import type { Aabb, Vec2 } from '../domain/types.js';
import { add, scale, subtract } from '../math/vector.js';

export function circleIntersectsAabb(center: Vec2, radius: number, box: Aabb): boolean {
  const x = Math.max(box.min.x, Math.min(center.x, box.max.x));
  const y = Math.max(box.min.y, Math.min(center.y, box.max.y));
  const dx = center.x - x;
  const dy = center.y - y;
  return dx * dx + dy * dy < radius * radius;
}

export function isCircleInBounds(center: Vec2, radius: number, bounds: Aabb): boolean {
  return center.x - radius >= bounds.min.x && center.x + radius <= bounds.max.x &&
    center.y - radius >= bounds.min.y && center.y + radius <= bounds.max.y;
}

export function moveCircle(position: Vec2, delta: Vec2, radius: number, bounds: Aabb, colliders: Aabb[]): Vec2 {
  let result = { ...position };
  const xCandidate = { x: result.x + delta.x, y: result.y };
  if (isCircleInBounds(xCandidate, radius, bounds) && !colliders.some((box) => circleIntersectsAabb(xCandidate, radius, box))) result.x = xCandidate.x;
  const yCandidate = { x: result.x, y: result.y + delta.y };
  if (isCircleInBounds(yCandidate, radius, bounds) && !colliders.some((box) => circleIntersectsAabb(yCandidate, radius, box))) result.y = yCandidate.y;
  return result;
}

export function segmentIntersectsAabb(start: Vec2, end: Vec2, box: Aabb): boolean {
  const direction = subtract(end, start);
  let near = 0;
  let far = 1;
  for (const axis of ['x', 'y'] as const) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (box.min[axis] - start[axis]) * inverse;
    let second = (box.max[axis] - start[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return true;
}

export function lineOfSight(a: Vec2, b: Vec2, blockers: Aabb[]): boolean {
  return !blockers.some((box) => segmentIntersectsAabb(a, b, box));
}

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
