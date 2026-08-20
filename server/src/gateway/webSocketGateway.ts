import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  envelope, gameBalance, parseClientMessage, type ClientMessage, type PlayerId, type ServerMessage
} from '@squirrel-heist/shared';
import { RoomManager } from '../room/roomManager.js';
import type { RoomConnection } from '../simulation/matchRoom.js';

interface Session { roomId: string | null; playerId: PlayerId | null; inputTimes: number[] }

export class WebSocketGateway {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly sessions = new Map<string, Session>();
  private readonly webSocketServer: WebSocketServer;

  constructor(readonly httpServer: HttpServer, private readonly rooms: RoomManager) {
    this.webSocketServer = new WebSocketServer({ server: httpServer, maxPayload: gameBalance.maxMessageBytes });
    this.webSocketServer.on('connection', (socket) => this.onConnection(socket));
  }

  private onConnection(socket: WebSocket): void {
    const connectionId = randomBytes(8).toString('hex');
    this.sockets.set(connectionId, socket);
    this.sessions.set(connectionId, { roomId: null, playerId: null, inputTimes: [] });
    socket.on('message', (data) => this.onMessage(connectionId, data));
    socket.on('close', () => this.onClose(connectionId));
    socket.on('error', (error) => console.warn(JSON.stringify({ level: 'warn', event: 'socket_error', connectionId, detail: error.message })));
  }

  private onMessage(connectionId: string, data: RawData): void {
    const session = this.sessions.get(connectionId);
    const socket = this.sockets.get(connectionId);
    if (!session || !socket) return;
    const bytes = Buffer.byteLength(data.toString());
    const room = session.roomId ? this.rooms.rooms.get(session.roomId) : undefined;
    if (room) room.metrics.receivedBytes += bytes;
    if (bytes > gameBalance.maxMessageBytes) { this.reject(socket, 'MESSAGE_TOO_LARGE'); return; }
    const message = parseClientMessage(data.toString());
    if (!message) { if (room) room.metrics.invalidMessages += 1; this.reject(socket, 'INVALID_MESSAGE'); return; }
    try { this.dispatch(connectionId, session, message); }
    catch (error) { this.reject(socket, error instanceof Error ? error.message : 'SERVER_ERROR'); }
  }

  private dispatch(connectionId: string, session: Session, message: ClientMessage): void {
    const socket = this.sockets.get(connectionId)!;
    if (message.type === 'C2S_JOIN_ROOM') {
      if (session.playerId) throw new Error('ALREADY_JOINED');
      const connection = this.makeConnection(connectionId);
      if (message.payload.reconnectToken) {
        for (const room of this.rooms.rooms.values()) {
          const player = room.reconnect(message.payload.reconnectToken, connection);
          if (!player) continue;
          session.roomId = room.id;
          session.playerId = player.id;
          connection.send(envelope('S2C_JOINED_ROOM', { playerId: player.id, team: player.team, roomId: room.id, phase: room.phase, reconnectToken: player.reconnectToken }, room.id));
          connection.send(room.fullStateFor(player.id));
          return;
        }
        throw new Error('RECONNECT_EXPIRED');
      }
      const { room, playerId } = this.rooms.join(message.payload.roomCode, connection, message.payload.displayName, message.payload.preferredTeam);
      const player = room.players.get(playerId)!;
      session.roomId = room.id;
      session.playerId = playerId;
      connection.send(envelope('S2C_JOINED_ROOM', { playerId, team: player.team, roomId: room.id, phase: room.phase, reconnectToken: player.reconnectToken }, room.id));
      connection.send(envelope('S2C_MAP_DEFINITION', { mapSeed: room.map.seed, generatorVersion: room.map.generatorVersion, map: room.map, mapHash: room.map.hash }, room.id));
      return;
    }
    if (!session.roomId || !session.playerId) throw new Error('NOT_JOINED');
    const room = this.rooms.rooms.get(session.roomId);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    switch (message.type) {
      case 'C2S_CLIENT_READY':
        if (!room.setReady(session.playerId, message.payload.mapHash, message.payload.assetsReady)) throw new Error('READY_REJECTED');
        break;
      case 'C2S_INPUT': {
        const now = Date.now();
        session.inputTimes = session.inputTimes.filter((time) => now - time < 1_000);
        if (session.inputTimes.length >= gameBalance.maxInputsPerSecond) { room.metrics.invalidMessages += 1; throw new Error('INPUT_RATE_LIMITED'); }
        session.inputTimes.push(now);
        room.enqueueInput(session.playerId, message.payload);
        break;
      }
      case 'C2S_PING':
        this.makeConnection(connectionId).send(envelope('S2C_PONG', { clientTimeMs: message.payload.clientTimeMs, serverTimeMs: Date.now() }, room.id));
        break;
      case 'C2S_REQUEST_RESYNC':
        this.makeConnection(connectionId).send(room.fullStateFor(session.playerId));
        break;
      default:
        break;
    }
  }

  private makeConnection(id: string): RoomConnection {
    return {
      id,
      send: (message: ServerMessage) => {
        const socket = this.sockets.get(id);
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        const text = JSON.stringify(message);
        socket.send(text);
        const session = this.sessions.get(id);
        if (session?.roomId) this.rooms.rooms.get(session.roomId)!.metrics.sentBytes += Buffer.byteLength(text);
      }
    };
  }

  private reject(socket: WebSocket, code: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope('S2C_ERROR', { code })));
  }

  private onClose(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session?.roomId && session.playerId) this.rooms.rooms.get(session.roomId)?.disconnect(session.playerId);
    this.sockets.delete(connectionId);
    this.sessions.delete(connectionId);
  }

  close(): void { this.webSocketServer.close(); }
}

export function createHealthServer(rooms: RoomManager): HttpServer {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.url === '/health') {
      response.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    if (request.url === '/metrics') {
      response.end(JSON.stringify({ rooms: [...rooms.rooms.values()].map((room) => ({ roomId: room.id, phase: room.phase, players: room.players.size, ...room.metrics.snapshot() })) }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
}
