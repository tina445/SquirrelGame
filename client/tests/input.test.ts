import { describe, expect, it } from 'vitest';
import { movementVectorForKeys } from '../src/input/inputSampler.js';

describe('keyboard movement mapping', () => {
  it.each([
    [['KeyA'], { x: -1, y: 0 }],
    [['KeyD'], { x: 1, y: 0 }],
    [['KeyW'], { x: 0, y: 1 }],
    [['KeyS'], { x: 0, y: -1 }],
    [['ArrowLeft'], { x: -1, y: 0 }],
    [['ArrowRight'], { x: 1, y: 0 }],
    [['ArrowUp'], { x: 0, y: 1 }],
    [['ArrowDown'], { x: 0, y: -1 }]
  ])('maps %s to the expected game direction', (codes, expected) => {
    expect(movementVectorForKeys(new Set(codes))).toEqual(expected);
  });

  it('normalizes diagonal movement', () => {
    const direction = movementVectorForKeys(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
    expect(direction.x).toBeGreaterThan(0);
    expect(direction.y).toBeGreaterThan(0);
  });
});
