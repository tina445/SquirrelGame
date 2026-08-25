import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { envelope, type ServerMessage } from '@squirrel-heist/shared';
import { WebSocketGateway } from '../src/gateway/webSocketGateway.js';
import { publicAccessPolicy } from '../src/gateway/publicAccessPolicy.js';
import { RoomManager } from '../src/room/roomManager.js';
import type { RoomConnection } from '../src/simulation/matchRoom.js';

interface FakeSocket {
  readyState: number;
  bufferedAmount: number;
  sent: ServerMessage[];
  callbacks: Array<() => void>;
  send(text: string, callback: () => void): void;
  close(): void;
}

/** 실제 network 없이 send callback을 지연해 snapshot backpressure와 reliable 우회를 검증한다. */
function fakeSocket(): FakeSocket {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    sent: [],
    callbacks: [],
    send(text, callback) { this.sent.push(JSON.parse(text) as ServerMessage); this.callbacks.push(callback); },
    close() { this.readyState = WebSocket.CLOSED; }
  };
}

describe('WebSocket snapshot backpressure', () => {
  it('keeps only the latest pending snapshot and sends reliable messages immediately', () => {
    const rooms = new RoomManager();
    const room = rooms.createRoom('BACKPRESSURE', 'backpressure');
    const httpServer = createServer();
    const gateway = new WebSocketGateway(httpServer, rooms, publicAccessPolicy({}));
    const socket = fakeSocket();
    const connectionId = 'fake-connection';
    const gatewayInternals = gateway as unknown as {
      sockets: Map<string, FakeSocket>;
      sessions: Map<string, { roomId: string | null; playerId: null; inputTimes: number[]; chatTimes: number[]; clientKey: string }>;
      outboundStates: Map<string, { snapshotInFlight: boolean; pendingSnapshot: ServerMessage | null }>;
      makeConnection(id: string): RoomConnection;
    };
    gatewayInternals.sockets.set(connectionId, socket);
    gatewayInternals.sessions.set(connectionId, { roomId: room.id, playerId: null, inputTimes: [], chatTimes: [], clientKey: 'test' });
    gatewayInternals.outboundStates.set(connectionId, { snapshotInFlight: false, pendingSnapshot: null });
    const connection = gatewayInternals.makeConnection(connectionId);
    const snapshot = (serverTick: number): ServerMessage => envelope('S2C_WORLD_SNAPSHOT', { ...room.snapshot(), serverTick }, room.id);

    connection.send(snapshot(1));
    connection.send(snapshot(2));
    connection.send(snapshot(3));
    connection.send(envelope('S2C_PONG', { clientTimeMs: 1, serverTimeMs: 2 }, room.id));

    expect(socket.sent.map((message) => message.type)).toEqual(['S2C_WORLD_SNAPSHOT', 'S2C_PONG']);
    expect(gatewayInternals.outboundStates.get(connectionId)?.pendingSnapshot).toMatchObject({ payload: { serverTick: 3 } });
    expect(room.metrics.snapshot().snapshotSupersededCount).toBe(1);

    socket.callbacks[0]!();
    expect(socket.sent).toHaveLength(3);
    expect(socket.sent[2]).toMatchObject({ type: 'S2C_WORLD_SNAPSHOT', payload: { serverTick: 3 } });
    expect(gatewayInternals.outboundStates.get(connectionId)?.pendingSnapshot).toBeNull();
    expect(room.metrics.snapshot()).toMatchObject({ snapshotSentCount: 2, snapshotSerializationCount: 2 });
    gateway.close();
  });
});
