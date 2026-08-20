import { describe, expect, it } from 'vitest';
import { gameBalance } from '@squirrel-heist/shared';
import { RoomManager } from '../src/room/roomManager.js';
import type { RoomConnection } from '../src/simulation/matchRoom.js';

const connection = (id: string): RoomConnection => ({ id, send: () => undefined });

describe('RoomManager', () => {
  it('allocates the ninth client to a new room instead of a full lobby', () => {
    const manager = new RoomManager();
    for (let index = 0; index < 9; index += 1) manager.join(undefined, connection(String(index)), `player-${index}`);
    expect(manager.rooms.size).toBe(2);
    expect([...manager.rooms.values()].map((room) => room.players.size).sort()).toEqual([1, 8]);
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
