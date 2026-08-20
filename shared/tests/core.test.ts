import { describe, expect, it } from 'vitest';
import {
  circleIntersectsAabb, findNearestValidPosition, moveCircle, normalize, parseClientMessage, protocolVersion
} from '../src/index.js';

describe('shared math and collision', () => {
  it('normalizes diagonal movement', () => {
    const value = normalize({ x: 1, y: 1 });
    expect(Math.hypot(value.x, value.y)).toBeCloseTo(1);
  });

  it('slides a circle along an AABB instead of entering it', () => {
    const box = { min: { x: 1, y: -1 }, max: { x: 2, y: 1 } };
    expect(circleIntersectsAabb({ x: 1, y: 0 }, 0.5, box)).toBe(true);
    expect(moveCircle({ x: 0, y: 0 }, { x: 2, y: 0.5 }, 0.4, { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } }, [box])).toEqual({ x: 0, y: 0.5 });
  });

  it('finds a valid nearby acorn drop position', () => {
    const point = findNearestValidPosition({ x: 0, y: 0 }, 0.25, { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } }, [{ min: { x: -0.4, y: -0.4 }, max: { x: 0.4, y: 0.4 } }]);
    expect(point).not.toBeNull();
    expect(circleIntersectsAabb(point!, 0.25, { min: { x: -0.4, y: -0.4 }, max: { x: 0.4, y: 0.4 } })).toBe(false);
  });
});

describe('runtime protocol validation', () => {
  it('accepts valid bounded input and rejects invalid/old protocol shapes', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion, payload: { sequence: 1, clientTick: 1, moveX: 1, moveY: 0, aimX: 1, aimY: 0, buttons: 0 } })))?.type).toBe('C2S_INPUT');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion, payload: { sequence: 1, clientTick: 1, moveX: 2, moveY: 0, aimX: 1, aimY: 0, buttons: 0 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion: 0, payload: {} }))).toBeNull();
  });
});
