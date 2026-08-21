import { describe, expect, it } from 'vitest';
import type { PlayerId, PlayerSnapshot } from '@squirrel-heist/shared';
import { rosterSlots, teammatesFor } from '../src/ui/lobby.js';

const player = (id: string, team: 'THIEF' | 'POLICE'): PlayerSnapshot => ({ id: id as PlayerId, displayName: id, team } as PlayerSnapshot);

describe('lobby roster visibility', () => {
  it('returns the local player team without listing opponents', () => {
    const players = [player('local', 'THIEF'), player('friend', 'THIEF'), player('opponent', 'POLICE')];
    expect(teammatesFor(players, players[0]!.id).map((item) => item.displayName)).toEqual(['local', 'friend']);
  });

  it('keeps a stable eight-slot friend-room roster', () => {
    const players = [player('local', 'THIEF'), player('friend', 'POLICE')];
    players[0]!.ready = true;
    players[0]!.assetsReady = true;
    const slots = rosterSlots(players, players[0]!.id);
    expect(slots).toHaveLength(8);
    expect(slots[0]).toMatchObject({ name: '나 · local', state: '준비' });
    expect(slots.filter((slot) => slot === null)).toHaveLength(6);
  });
});
