import { describe, expect, it } from 'vitest';
import { actionButtonForKey, movementVectorForKeys } from '../src/input/inputSampler.js';
import { InputButton } from '@squirrel-heist/shared';

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

  it('combines WASD and arrow keys on the same world axes', () => {
    expect(movementVectorForKeys(new Set(['KeyW', 'ArrowUp']))).toEqual({ x: 0, y: 1 });
    expect(movementVectorForKeys(new Set(['KeyA', 'ArrowRight']))).toEqual({ x: 0, y: 0 });
  });

  it('maps Space and only the left Shift key to contextual actions', () => {
    expect(actionButtonForKey('Space')).toBe(InputButton.INTERACT);
    expect(actionButtonForKey('ShiftLeft')).toBe(InputButton.ACORN);
    expect(actionButtonForKey('ShiftRight')).toBe(0);
    expect(actionButtonForKey('KeyE')).toBe(0);
    expect(actionButtonForKey('KeyF')).toBe(0);
  });
});
