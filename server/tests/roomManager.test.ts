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

  it('rejects a twenty-fifth new player while retaining a disconnected player slot for reconnect', () => {
    const manager = new RoomManager({ maxPlayers: 24 });
    const joined = Array.from({ length: 24 }, (_, index) => manager.join('QUICK_MATCH', undefined, connection(String(index)), `player-${index}`));
    expect(manager.playerCount()).toBe(24);
    expect(() => manager.join('QUICK_MATCH', undefined, connection('overflow'), 'overflow')).toThrow('SERVER_FULL');

    const player = joined[0]!.room.players.get(joined[0]!.playerId)!;
    joined[0]!.room.disconnect(player.id, '0');
    expect(joined[0]!.room.reconnect(player.reconnectToken, connection('replacement'))?.id).toBe(player.id);
    expect(manager.playerCount()).toBe(24);
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

  it('opens another public room instead of overflowing an explicit role reservation', () => {
    const manager = new RoomManager();
    for (let index = 0; index < 5; index += 1) manager.join('QUICK_MATCH', undefined, connection(`police-${index}`), `police-${index}`, 'POLICE');
    expect(manager.rooms.size).toBe(2);
    expect([...manager.rooms.values()].map((room) => room.players.size).sort()).toEqual([1, 4]);
  });

  it('randomizes equal-count roles while preserving a four-versus-four balance', () => {
    const room = new MatchRoom({ id: 'RANDOM', seed: 'random-roles', teamSeed: 'team-seed' });
    for (let index = 0; index < 8; index += 1) room.addPlayer(connection(`random-${index}`), `random-${index}`);
    expect([...room.players.values()].every((player) => player.team === null)).toBe(true);
    room.startImmediately();
    const teams = [...room.players.values()].map((player) => player.team);
    const repeated = new MatchRoom({ id: 'SAME', seed: 'random-roles', teamSeed: 'team-seed' });
    for (let index = 0; index < 8; index += 1) repeated.addPlayer(connection(`repeated-${index}`), `repeated-${index}`);
    repeated.startImmediately();

    expect(teams.filter((team) => team === 'THIEF')).toHaveLength(4);
    expect(teams.filter((team) => team === 'POLICE')).toHaveLength(4);
    expect([...repeated.players.values()].map((player) => player.team)).toEqual(teams);
  });

  it('reserves explicit roles, rejects a fifth reservation, and finalizes only at start', () => {
    const room = new MatchRoom({ id: 'PREFERENCES', seed: 'preferences' });
    for (let index = 0; index < 4; index += 1) room.addPlayer(connection(`police-${index}`), `police-${index}`, 'POLICE');
    expect(() => room.addPlayer(connection('overflow'), 'overflow', 'POLICE')).toThrow('ROLE_FULL');
    for (let index = 0; index < 4; index += 1) room.addPlayer(connection(`thief-${index}`), `thief-${index}`, 'THIEF');
    expect([...room.players.values()].every((player) => player.team === null)).toBe(true);
    room.startImmediately();
    expect([...room.players.values()].filter((player) => player.team === 'POLICE')).toHaveLength(4);
    expect([...room.players.values()].filter((player) => player.team === 'THIEF')).toHaveLength(4);
  });

  it('removes the final lobby player and cleans the empty room immediately', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('EMPTY', 'empty-room');
    const player = room.addPlayer(connection('only'), 'only', 'THIEF');
    expect(room.leaveLobby(player.id, 'only')).toBe(true);
    manager.cleanup();
    expect(manager.rooms.has(room.id)).toBe(false);
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
