import { describe, expect, it } from 'vitest';
import { gameBalance } from '@squirrel-heist/shared';
import { RoomManager } from '../src/room/roomManager.js';
import { MatchRoom, type RoomConnection } from '../src/simulation/matchRoom.js';

const connection = (id: string): RoomConnection => ({ id, send: () => undefined });

describe('RoomManager', () => {
  it('allocates the ninth client to a new room instead of a full lobby', () => {
    const manager = new RoomManager();
    for (let index = 0; index < 9; index += 1) manager.join('QUICK_MATCH', undefined, connection(String(index)), `player-${index}`);
    expect(manager.rooms.size).toBe(2);
    expect([...manager.rooms.values()].map((room) => room.players.size).sort()).toEqual([1, 8]);
  });

  it('keeps private rooms out of quick matching and joins them by normalized code', () => {
    const manager = new RoomManager();
    const created = manager.join('CREATE_ROOM', undefined, connection('host'), 'host').room;
    const publicRoom = manager.join('QUICK_MATCH', undefined, connection('quick'), 'quick').room;
    const joined = manager.join('JOIN_ROOM', created.id.toLowerCase(), connection('friend'), 'friend').room;

    expect(created.listed).toBe(false);
    expect(publicRoom).not.toBe(created);
    expect(joined).toBe(created);
  });

  it('randomizes equal-count roles while preserving a four-versus-four balance', () => {
    const room = new MatchRoom({ id: 'RANDOM', seed: 'random-roles', teamSeed: 'team-seed' });
    for (let index = 0; index < 8; index += 1) room.addPlayer(connection(`random-${index}`), `random-${index}`);
    const teams = [...room.players.values()].map((player) => player.team);
    const repeated = new MatchRoom({ id: 'SAME', seed: 'random-roles', teamSeed: 'team-seed' });
    for (let index = 0; index < 8; index += 1) repeated.addPlayer(connection(`repeated-${index}`), `repeated-${index}`);

    expect(teams.filter((team) => team === 'THIEF')).toHaveLength(4);
    expect(teams.filter((team) => team === 'POLICE')).toHaveLength(4);
    expect([...repeated.players.values()].map((player) => player.team)).toEqual(teams);
  });

  it('removes expired lobby ghosts so their slot can be matched again', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('LOBBY', 'lobby-expiry');
    const leaver = room.addPlayer(connection('leaver'), 'leaver');
    room.addPlayer(connection('stayer'), 'stayer');
    room.disconnect(leaver.id, 'leaver');

    room.tick(gameBalance.reconnectGraceMs + 1);

    expect(room.players.has(leaver.id)).toBe(false);
    expect(room.players.size).toBe(1);
    expect(room.phase).toBe('LOBBY');
  });

  it('removes an abandoned playing room after every reconnect grace period expires', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('ABANDONED', 'abandoned');
    const player = room.addPlayer(connection('leaver'), 'leaver', 'THIEF');
    room.startImmediately();
    room.disconnect(player.id);

    room.tick(gameBalance.reconnectGraceMs + 1);
    manager.cleanup();

    expect(room.phase).toBe('CLOSED');
    expect(manager.rooms.size).toBe(0);
  });
});
