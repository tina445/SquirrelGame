import { describe, expect, it } from 'vitest';
import {
  circleIntersectsAabb, findNearestValidPosition, isCircleInPolygon, isWithinCircleReach, moveCircle, normalize, parseClientMessage, protocolVersion, segmentAabbHitFraction
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

  it('reports the first swept-segment wall hit fraction', () => {
    expect(segmentAabbHitFraction({ x: -1, y: 0 }, { x: 1, y: 0 }, { min: { x: 0, y: -1 }, max: { x: 0.2, y: 1 } })).toBeCloseTo(0.5);
  });

  it('keeps circles inside an irregular polygon boundary', () => {
    const polygon = [{ x: -2, y: -1 }, { x: 2, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    expect(isCircleInPolygon({ x: 0, y: 0 }, 0.4, polygon)).toBe(true);
    expect(isCircleInPolygon({ x: 1.7, y: 0.8 }, 0.2, polygon)).toBe(false);
    expect(moveCircle({ x: 0, y: 0 }, { x: 3, y: 0 }, 0.4, { min: { x: -2, y: -1 }, max: { x: 2, y: 1 } }, [], polygon)).toEqual({ x: 0, y: 0 });
  });

  it('slides around a circular tree trunk while its canopy remains non-colliding', () => {
    const bounds = { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } };
    const moved = moveCircle({ x: -1.2, y: 0 }, { x: 1, y: 0.5 }, 0.4, bounds, [], undefined, [], [{ center: { x: 0, y: 0 }, radius: 0.8 }]);
    expect(moved).toEqual({ x: -1.2, y: 0.5 });
  });

  it('blocks movement through a circular jail footprint and allows interaction from its outer edge', () => {
    const jail = { center: { x: 0, y: 0 }, radius: 2.6 };
    const bounds = { min: { x: -8, y: -8 }, max: { x: 8, y: 8 } };
    const moved = moveCircle({ x: -3.2, y: 0 }, { x: 0.5, y: 0.4 }, 0.52, bounds, [], undefined, [], [jail]);
    expect(moved).toEqual({ x: -3.2, y: 0.4 });
    expect(isWithinCircleReach({ x: -3.9, y: 0 }, jail, 1.4)).toBe(true);
    expect(isWithinCircleReach({ x: -4.1, y: 0 }, jail, 1.4)).toBe(false);
  });
});

describe('runtime protocol validation', () => {
  it('accepts valid bounded input and rejects invalid/old protocol shapes', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion, payload: { sequence: 1, clientTick: 1, moveX: 1, moveY: 0, aimX: 1, aimY: 0, buttons: 0 } }))?.type).toBe('C2S_INPUT');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion, payload: { sequence: 1, clientTick: 1, moveX: 2, moveY: 0, aimX: 1, aimY: 0, buttons: 0 } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_INPUT', protocolVersion: 0, payload: {} }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_JOIN_ROOM', protocolVersion, payload: { joinMode: 'JOIN_ROOM', displayName: 'squirrel', clientVersion: 'test' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_JOIN_ROOM', protocolVersion, payload: { joinMode: 'JOIN_ROOM', roomCode: 'ABC123', displayName: 'squirrel', clientVersion: 'test' } }))?.type).toBe('C2S_JOIN_ROOM');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_JOIN_ROOM', protocolVersion, payload: { joinMode: 'QUICK_MATCH', displayName: 'squirrel', clientVersion: 'test', rolePreference: 'THIEF' } }))?.type).toBe('C2S_JOIN_ROOM');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_JOIN_ROOM', protocolVersion, payload: { joinMode: 'CREATE_ROOM', displayName: 'squirrel', clientVersion: 'test', rolePreference: 'RANDOM' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_SET_ROLE_PREFERENCE', protocolVersion, payload: { rolePreference: 'POLICE' } }))?.type).toBe('C2S_SET_ROLE_PREFERENCE');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_START_MATCH', protocolVersion, payload: {} }))?.type).toBe('C2S_START_MATCH');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_TRANSFER_HOST', protocolVersion, payload: { targetPlayerId: 'player-2' } }))?.type).toBe('C2S_TRANSFER_HOST');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_SET_READY', protocolVersion, payload: { ready: true } }))?.type).toBe('C2S_SET_READY');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_LEAVE_ROOM', protocolVersion, payload: {} }))?.type).toBe('C2S_LEAVE_ROOM');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_CHAT', protocolVersion, payload: { text: '안녕하세요' } }))?.type).toBe('C2S_CHAT');
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_CHAT', protocolVersion, payload: { text: '   ' } }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'C2S_CHAT', protocolVersion, payload: { text: 'x'.repeat(121) } }))).toBeNull();
  });
});
