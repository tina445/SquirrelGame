import type { Vec2 } from '../domain/types.js';

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (value: Vec2, scalar: number): Vec2 => ({ x: value.x * scalar, y: value.y * scalar });
export const lengthSquared = (value: Vec2): number => value.x * value.x + value.y * value.y;
export const distanceSquared = (a: Vec2, b: Vec2): number => lengthSquared(subtract(a, b));
export const normalize = (value: Vec2): Vec2 => {
  const magnitude = Math.sqrt(lengthSquared(value));
  return magnitude > 0 ? scale(value, 1 / magnitude) : { x: 0, y: 0 };
};
export const clampMagnitude = (value: Vec2, maximum = 1): Vec2 => {
  const magnitudeSquared = lengthSquared(value);
  return magnitudeSquared > maximum * maximum ? scale(value, maximum / Math.sqrt(magnitudeSquared)) : value;
};
export const lerp = (a: Vec2, b: Vec2, alpha: number): Vec2 => ({
  x: a.x + (b.x - a.x) * alpha,
  y: a.y + (b.y - a.y) * alpha
});
