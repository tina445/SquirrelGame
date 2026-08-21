import { describe, expect, it } from 'vitest';
import type { PlayerId, PlayerSnapshot } from '@squirrel-heist/shared';
import { canStartFriendMatch, rosterSlots, teammatesFor } from '../src/ui/lobby.js';
import { createLobbyPresentationPolicy } from '../src/ui/lobbyPresentationPolicy.js';

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

  it('shows selected roles before ready and enables start only for a complete four-versus-four room', () => {
    const players = Array.from({ length: 8 }, (_, index) => ({
      id: `player-${index}` as PlayerId,
      displayName: `player-${index}`,
      team: null,
      rolePreference: index < 4 ? 'POLICE' : 'THIEF',
      assetsReady: true,
      ready: true,
      disconnectedAtMs: null
    } as PlayerSnapshot));
    const slots = rosterSlots(players, players[0]!.id, players[0]!.id);
    expect(slots[0]).toMatchObject({ name: '나 · player-0 · 방장', rolePreference: 'POLICE', ready: true, isHost: true });
    expect(canStartFriendMatch(players)).toBe(true);
    players[7]!.ready = false;
    expect(canStartFriendMatch(players)).toBe(false);
  });

  it('keeps quick matching separate from the completed roster presentation', () => {
    const policy = createLobbyPresentationPolicy('QUICK_MATCH');
    expect(policy.resolve('LOBBY', 3, false, false)).toMatchObject({ showMatchmaking: true, showRoster: false });
    expect(policy.resolve('COUNTDOWN', 8, true, false)).toMatchObject({ showMatchmaking: false, showRoster: true });
    expect(createLobbyPresentationPolicy('FRIEND_ROOM').resolve('LOBBY', 2, false, true)).toMatchObject({ showMatchmaking: false, showRoster: true, showFriendControls: true });
  });
});
