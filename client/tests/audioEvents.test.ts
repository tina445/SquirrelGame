import { describe, expect, it } from 'vitest';
import type { GameEvent, PlayerId } from '@squirrel-heist/shared';
import { soundEffectForGameEvent } from '../src/audio/audioEvents.js';

const localId = 'local' as PlayerId;
const event = (type: string, payload: Record<string, unknown> = {}): GameEvent => ({ eventId: 'event-1', type, tick: 1, payload });

describe('game event audio mapping', () => {
  it('plays personal reward sounds only for the actor or affected player', () => {
    expect(soundEffectForGameEvent(event('BERRY_PICKED_UP', { playerId: localId }), localId, 'THIEF')).toBe('berryPickup');
    expect(soundEffectForGameEvent(event('ACORN_DROPPED', { playerId: 'other' }), localId, 'THIEF')).toBeNull();
    expect(soundEffectForGameEvent(event('ACORN_STOLEN', { playerId: 'other', targetId: localId }), localId, 'POLICE')).toBe('acornStolen');
  });

  it('keeps high-impact stun, arrest, rescue, and wall effects audible to every recipient', () => {
    expect(soundEffectForGameEvent(event('THUNDER_HIT'), localId, 'POLICE')).toBe('thunderHit');
    expect(soundEffectForGameEvent(event('THUNDER_HIT_WALL'), localId, 'POLICE')).toBe('thunderWall');
    expect(soundEffectForGameEvent(event('ARREST_COMPLETED'), localId, 'POLICE')).toBe('arrest');
    expect(soundEffectForGameEvent(event('RESCUE_COMPLETED'), localId, 'THIEF')).toBe('rescue');
  });

  it('uses the local team to choose victory or defeat', () => {
    expect(soundEffectForGameEvent(event('MATCH_FINISHED', { winner: 'THIEF' }), localId, 'THIEF')).toBe('victory');
    expect(soundEffectForGameEvent(event('MATCH_FINISHED', { winner: 'THIEF' }), localId, 'POLICE')).toBe('defeat');
    expect(soundEffectForGameEvent(event('MATCH_FINISHED', { winner: 'THIEF' }), localId, null)).toBeNull();
  });
});
