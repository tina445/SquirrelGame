import { describe, expect, it } from 'vitest';
import { type ServerMessage } from '@squirrel-heist/shared';
import { RoomBotCoordinator } from '../src/bot/roomBotCoordinator.js';
import { MatchRoom, type RoomConnection } from '../src/simulation/matchRoom.js';

const connection = (id: string): RoomConnection => ({ id, send: (_message: ServerMessage) => undefined });

describe('RoomBotCoordinator', () => {
  it('adds one bot after the delay and one per interval while humans may still join', () => {
    const room = new MatchRoom({ id: 'bots', seed: 'bots', lobbyKind: 'QUICK_MATCH' });
    const human = room.addPlayer(connection('human'), 'human', 'RANDOM');
    room.setAssetsReady(human.id, room.map.hash, true);
    const coordinator = new RoomBotCoordinator({ fillDelayMs: 100, fillIntervalMs: 50 });
    room.tick(99);
    coordinator.beforeTick(room);
    expect(room.botPlayers).toHaveLength(0);
    room.tick(1);
    coordinator.beforeTick(room);
    expect(room.botPlayers).toHaveLength(1);
    expect(room.botPlayers[0]!.displayName).toMatch(/^다람쥐\d{4}$/);
    expect(room.snapshot().players.some((player) => 'control' in player)).toBe(false);
    room.addPlayer(connection('second-human'), 'second-human', 'RANDOM');
    room.tick(49);
    coordinator.beforeTick(room);
    expect(room.botPlayers).toHaveLength(1);
    room.tick(1);
    coordinator.beforeTick(room);
    expect(room.botPlayers).toHaveLength(2);
  });

  it('fills to eight and starts countdown with a constrained four-versus-four assignment', () => {
    const room = new MatchRoom({ id: 'full-bots', seed: 'full-bots', lobbyKind: 'QUICK_MATCH' });
    const human = room.addPlayer(connection('human'), 'human', 'POLICE');
    room.setAssetsReady(human.id, room.map.hash, true);
    const coordinator = new RoomBotCoordinator({ fillDelayMs: 0, fillIntervalMs: 0 });
    for (let index = 0; index < 7; index += 1) coordinator.beforeTick(room);
    expect(room.players.size).toBe(8);
    expect(room.phase).toBe('COUNTDOWN');
    expect([...room.players.values()].filter((player) => player.team === 'POLICE')).toHaveLength(4);
    expect([...room.players.values()].filter((player) => player.team === 'THIEF')).toHaveLength(4);
    room.tick(3_000);
    coordinator.beforeTick(room);
    room.tick();
    expect(room.botPlayers.every((player) => player.lastProcessedInputSequence >= 0)).toBe(true);
    expect(room.metrics.snapshot().botDecisionP95Ms).toBeGreaterThanOrEqual(0);
  });

  it('does not fill friend rooms or rooms without an active human', () => {
    const friend = new MatchRoom({ id: 'friend-bots', seed: 'friend-bots', lobbyKind: 'FRIEND_ROOM' });
    friend.addPlayer(connection('friend'), 'friend', null);
    const quick = new MatchRoom({ id: 'empty-bots', seed: 'empty-bots', lobbyKind: 'QUICK_MATCH' });
    const human = quick.addPlayer(connection('quick'), 'quick', 'RANDOM');
    quick.disconnect(human.id, 'quick');
    const coordinator = new RoomBotCoordinator({ fillDelayMs: 0, fillIntervalMs: 0 });
    coordinator.beforeTick(friend);
    coordinator.beforeTick(quick);
    expect(friend.botPlayers).toHaveLength(0);
    expect(quick.botPlayers).toHaveLength(0);
  });

  it('supports an explicit server-side disable switch', () => {
    const room = new MatchRoom({ id: 'disabled-bots', seed: 'disabled-bots', lobbyKind: 'QUICK_MATCH' });
    room.addPlayer(connection('human'), 'human', 'RANDOM');
    new RoomBotCoordinator({ enabled: false, fillDelayMs: 0 }).beforeTick(room);
    expect(room.botPlayers).toHaveLength(0);
  });
});
