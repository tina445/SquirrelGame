import { describe, expect, it } from 'vitest';
import type { PlayerId, PlayerSnapshot } from '@squirrel-heist/shared';
import { teammatesFor } from '../src/ui/lobby.js';

const player = (id: string, team: 'THIEF' | 'POLICE'): PlayerSnapshot => ({ id: id as PlayerId, displayName: id, team } as PlayerSnapshot);

describe('lobby roster visibility', () => {
  it('returns the local player team without listing opponents', () => {
    const players = [player('local', 'THIEF'), player('friend', 'THIEF'), player('opponent', 'POLICE')];
    expect(teammatesFor(players, players[0]!.id).map((item) => item.displayName)).toEqual(['local', 'friend']);
  });
});
