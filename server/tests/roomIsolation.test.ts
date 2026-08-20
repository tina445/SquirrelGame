import { describe, expect, it, vi } from 'vitest';
import { MatchRoom, type RoomConnection } from '../src/simulation/matchRoom.js';
import { tickRooms } from '../src/simulation/fixedTickLoop.js';
import type { ServerMessage } from '@squirrel-heist/shared';

describe('Room exception boundary', () => {
  it('closes and notifies only the failed Room while other Rooms keep ticking', () => {
    const sent: ServerMessage[] = [];
    const closed: number[] = [];
    const connection: RoomConnection = { id: 'connection', send: (message) => sent.push(message), close: (code) => closed.push(code) };
    const failed = new MatchRoom({ id: 'failed', seed: 'failed', allowEarlyStart: true });
    const healthy = new MatchRoom({ id: 'healthy', seed: 'healthy', allowEarlyStart: true });
    failed.addPlayer(connection, 'player', 'THIEF');
    const failure = vi.spyOn(failed, 'tick').mockImplementation(() => { throw new Error('injected failure'); });

    tickRooms([failed, healthy]);

    expect(failure).toHaveBeenCalledOnce();
    expect(failed.phase).toBe('CLOSED');
    expect(healthy.serverTick).toBe(1);
    expect(sent.some((message) => message.type === 'S2C_ERROR' && message.payload.code === 'ROOM_SIMULATION_FAILED')).toBe(true);
    expect(closed).toEqual([1011]);
  });
});
