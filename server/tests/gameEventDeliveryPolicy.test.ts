import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@squirrel-heist/shared';
import { DefaultGameEventDeliveryPolicy } from '../src/events/gameEventDeliveryPolicy.js';

const event: GameEvent = { eventId: 'event-1', type: 'TEST', tick: 1, payload: {} };

describe('DefaultGameEventDeliveryPolicy', () => {
  it('broadcasts ordinary events while restricting a team event to its intended recipients', () => {
    const policy = new DefaultGameEventDeliveryPolicy();
    expect(policy.canDeliver({ event, audience: { kind: 'ALL' } }, 'POLICE')).toBe(true);
    expect(policy.canDeliver({ event, audience: { kind: 'ALL' } }, null)).toBe(true);
    expect(policy.canDeliver({ event, audience: { kind: 'TEAM', team: 'THIEF' } }, 'THIEF')).toBe(true);
    expect(policy.canDeliver({ event, audience: { kind: 'TEAM', team: 'THIEF' } }, 'POLICE')).toBe(false);
    expect(policy.canDeliver({ event, audience: { kind: 'TEAM', team: 'THIEF' } }, null)).toBe(false);
  });
});
