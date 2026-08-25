import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import {
  envelope, gameBalance, parseClientMessage, type ClientMessage, type PlayerId, type ServerMessage
} from '@squirrel-heist/shared';
import { RoomManager } from '../room/roomManager.js';
import type { RoomConnection } from '../simulation/matchRoom.js';
import { JoinRateLimiter, type PublicAccessPolicy } from './publicAccessPolicy.js';

interface Session { roomId: string | null; playerId: PlayerId | null; inputTimes: number[]; chatTimes: number[]; clientKey: string }
interface SerializedMessage { text: string; bytes: number }
interface OutboundState { snapshotInFlight: boolean; pendingSnapshot: ServerMessage | null }

export const snapshotBackpressureBytes = 64 * 1_024;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon'
};

/** 쉼표로 구분된 브라우저 Origin allow-list를 읽는다. 비어 있으면 개발·신뢰망 기본값으로 모두 허용한다. */
function allowedOrigins(): Set<string> {
  return new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
}

/** Cloud Run proxy를 신뢰하도록 명시한 경우에만 전달된 원본 IP를 신규 입장 rate-limit key로 사용한다. */
export function clientKeyFor(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first && first.length <= 64) return `forwarded:${first}`;
  }
  return `socket:${request.socket.remoteAddress ?? 'unknown'}`;
}

/** metrics token을 설정한 공개 배포에서만 Authorization Bearer 값을 요구한다. */
export function isMetricsAuthorized(authorization: string | undefined, metricsToken: string | null): boolean {
  return !metricsToken || authorization === `Bearer ${metricsToken}`;
}

/** Vite 산출물의 정적 파일만 제공하고 경로 이탈과 API route의 SPA fallback을 차단한다. */
function serveStatic(requestUrl: string | undefined, response: import('node:http').ServerResponse): boolean {
  const staticDir = process.env.STATIC_DIR;
  if (!staticDir) return false;
  const root = resolve(staticDir);
  const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname;
  let requested: string;
  try { requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); }
  catch { return false; }
  const candidate = resolve(root, requested);
  const isInsideRoot = candidate === root || candidate.startsWith(`${root}${sep}`);
  const fallback = resolve(root, 'index.html');
  const file = isInsideRoot && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : extname(basename(requested)) === '' && existsSync(fallback) ? fallback : null;
  if (!file) return false;
  response.statusCode = 200;
  response.setHeader('content-type', contentTypes[extname(file)] ?? 'application/octet-stream');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'same-origin');
  response.setHeader('cache-control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  createReadStream(file).pipe(response);
  return true;
}

export class WebSocketGateway {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly sessions = new Map<string, Session>();
  private readonly webSocketServer: WebSocketServer;
  private readonly joinRateLimiter: JoinRateLimiter;
  private readonly serializedMessages = new WeakMap<ServerMessage, SerializedMessage>();
  private readonly outboundStates = new Map<string, OutboundState>();

  /** HTTP 서버에 WebSocket 경계를 붙이고 payload 상한을 transport 단계에서 강제한다. */
  constructor(readonly httpServer: HttpServer, private readonly rooms: RoomManager, private readonly access: PublicAccessPolicy) {
    const origins = allowedOrigins();
    this.joinRateLimiter = new JoinRateLimiter(access.joinAttemptsPerMinute);
    this.webSocketServer = new WebSocketServer({
      server: httpServer,
      maxPayload: gameBalance.maxMessageBytes,
      verifyClient: ({ origin }, done) => done(origins.size === 0 || (!!origin && origins.has(origin)), 403, 'ORIGIN_NOT_ALLOWED')
    });
    this.webSocketServer.on('connection', (socket, request) => this.onConnection(socket, request));
  }

  /** 소켓별 세션을 만들고 이후 메시지·종료 이벤트를 동일 connection ID로 연결한다. */
  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const connectionId = randomBytes(8).toString('hex');
    this.sockets.set(connectionId, socket);
    this.sessions.set(connectionId, { roomId: null, playerId: null, inputTimes: [], chatTimes: [], clientKey: clientKeyFor(request, this.access.trustProxy) });
    this.outboundStates.set(connectionId, { snapshotInFlight: false, pendingSnapshot: null });
    socket.on('message', (data) => this.onMessage(connectionId, data));
    socket.on('close', () => this.onClose(connectionId));
    socket.on('error', (error) => console.warn(JSON.stringify({ level: 'warn', event: 'socket_error', connectionId, detail: error.message })));
  }

  /** 원시 프레임 크기와 공통 프로토콜을 검증한 뒤 인증된 세션 디스패치로 넘긴다. */
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

  /** 입장 전/후 허용 메시지를 분리하고 Room 권위 API 외의 상태 변경을 막는다. */
  private dispatch(connectionId: string, session: Session, message: ClientMessage): void {
    if (message.type === 'C2S_JOIN_ROOM') {
      if (session.playerId) throw new Error('ALREADY_JOINED');
      const connection = this.makeConnection(connectionId);
      if (message.payload.reconnectToken) {
        for (const room of this.rooms.rooms.values()) {
          const player = room.reconnect(message.payload.reconnectToken, connection);
          if (!player) continue;
          session.roomId = room.id;
          session.playerId = player.id;
          connection.send(envelope('S2C_JOINED_ROOM', { playerId: player.id, team: player.team, roomId: room.id, phase: room.phase, reconnectToken: player.reconnectToken, listed: room.listed, lobbyKind: room.lobbyKind, rolePreference: player.rolePreference, hostPlayerId: room.hostPlayerId }, room.id));
          connection.send(room.fullState());
          return;
        }
        throw new Error('RECONNECT_EXPIRED');
      }
      if (!this.joinRateLimiter.allow(session.clientKey)) throw new Error('JOIN_RATE_LIMITED');
      const joinMode = message.payload.joinMode ?? (message.payload.roomCode ? 'JOIN_ROOM' : 'QUICK_MATCH');
      const { room, playerId } = this.rooms.join(joinMode, message.payload.roomCode, connection, message.payload.displayName, message.payload.rolePreference);
      const player = room.players.get(playerId)!;
      session.roomId = room.id;
      session.playerId = playerId;
      connection.send(envelope('S2C_JOINED_ROOM', { playerId, team: player.team, roomId: room.id, phase: room.phase, reconnectToken: player.reconnectToken, listed: room.listed, lobbyKind: room.lobbyKind, rolePreference: player.rolePreference, hostPlayerId: room.hostPlayerId }, room.id));
      connection.send(envelope('S2C_MAP_DEFINITION', { mapSeed: room.map.seed, generatorVersion: room.map.generatorVersion, map: room.map, mapHash: room.map.hash }, room.id));
      return;
    }
    if (!session.roomId || !session.playerId) throw new Error('NOT_JOINED');
    const room = this.rooms.rooms.get(session.roomId);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    switch (message.type) {
      case 'C2S_CLIENT_READY':
        if (!room.setAssetsReady(session.playerId, message.payload.mapHash, message.payload.assetsReady)) throw new Error('READY_REJECTED');
        break;
      case 'C2S_SET_ROLE_PREFERENCE':
        if (!room.setRolePreference(session.playerId, message.payload.rolePreference)) throw new Error('ROLE_CHANGE_REJECTED');
        this.makeConnection(connectionId).send(envelope('S2C_ROLE_PREFERENCE_UPDATED', { rolePreference: message.payload.rolePreference }, room.id));
        break;
      case 'C2S_SET_READY':
        if (!room.setPlayerReady(session.playerId, message.payload.ready)) throw new Error('READY_REJECTED');
        break;
      case 'C2S_START_MATCH':
        if (!room.startMatch(session.playerId)) throw new Error('START_REJECTED');
        break;
      case 'C2S_TRANSFER_HOST':
        if (!room.transferHost(session.playerId, message.payload.targetPlayerId as PlayerId)) throw new Error('HOST_TRANSFER_REJECTED');
        break;
      case 'C2S_LEAVE_ROOM': {
        if (!room.leaveLobby(session.playerId, connectionId)) throw new Error('LEAVE_NOT_ALLOWED');
        this.makeConnection(connectionId).send(envelope('S2C_LEFT_ROOM', { roomId: room.id }));
        session.roomId = null;
        session.playerId = null;
        session.inputTimes = [];
        session.chatTimes = [];
        this.rooms.cleanup();
        break;
      }
      case 'C2S_INPUT': {
        const now = Date.now();
        session.inputTimes = session.inputTimes.filter((time) => now - time < 1_000);
        if (session.inputTimes.length >= gameBalance.maxInputsPerSecond) { room.metrics.invalidMessages += 1; throw new Error('INPUT_RATE_LIMITED'); }
        session.inputTimes.push(now);
        room.enqueueInput(session.playerId, message.payload);
        break;
      }
      case 'C2S_CHAT': {
        const now = Date.now();
        session.chatTimes = session.chatTimes.filter((time) => now - time < 1_000);
        if (session.chatTimes.length >= gameBalance.maxChatMessagesPerSecond) { room.metrics.invalidMessages += 1; throw new Error('CHAT_RATE_LIMITED'); }
        if (!room.sendChat(session.playerId, message.payload.text)) throw new Error('CHAT_NOT_AVAILABLE');
        session.chatTimes.push(now);
        break;
      }
      case 'C2S_PING':
        this.makeConnection(connectionId).send(envelope('S2C_PONG', { clientTimeMs: message.payload.clientTimeMs, serverTimeMs: Date.now() }, room.id));
        break;
      case 'C2S_REQUEST_RESYNC':
        this.makeConnection(connectionId).send(room.fullState());
        break;
      default:
        break;
    }
  }

  /** Room이 transport 구현을 직접 알지 않도록 송신·종료 기능만 가진 adapter를 만든다. */
  private makeConnection(id: string): RoomConnection {
    return {
      id,
      send: (message: ServerMessage) => this.send(id, message),
      close: (code, reason) => this.sockets.get(id)?.close(code, reason)
    };
  }

  /** snapshot은 연결별 최신 한 개만 대기시키고 그 외 reliable 메시지는 즉시 WebSocket 큐에 넣는다. */
  private send(connectionId: string, message: ServerMessage): void {
    const socket = this.sockets.get(connectionId);
    const outbound = this.outboundStates.get(connectionId);
    if (!socket || !outbound || socket.readyState !== WebSocket.OPEN) return;
    if (message.type !== 'S2C_WORLD_SNAPSHOT') {
      this.sendSerialized(connectionId, message, false);
      return;
    }
    const room = this.roomFor(connectionId);
    room?.metrics.observeBufferedAmount(socket.bufferedAmount);
    if (outbound.snapshotInFlight || socket.bufferedAmount > snapshotBackpressureBytes) {
      if (outbound.pendingSnapshot && room) room.metrics.snapshotSupersededCount += 1;
      outbound.pendingSnapshot = message;
      return;
    }
    if (outbound.pendingSnapshot) {
      if (room) room.metrics.snapshotSupersededCount += 1;
      outbound.pendingSnapshot = null;
    }
    this.sendSerialized(connectionId, message, true);
  }

  /** 객체 identity별 JSON 문자열을 재사용하고 실제 송신·callback·버퍼 지표를 Room에 귀속한다. */
  private sendSerialized(connectionId: string, message: ServerMessage, snapshot: boolean): void {
    const socket = this.sockets.get(connectionId);
    const outbound = this.outboundStates.get(connectionId);
    if (!socket || !outbound || socket.readyState !== WebSocket.OPEN) return;
    const room = this.roomFor(connectionId);
    let serialized = this.serializedMessages.get(message);
    if (!serialized) {
      const started = performance.now();
      const text = JSON.stringify(message);
      serialized = { text, bytes: Buffer.byteLength(text) };
      this.serializedMessages.set(message, serialized);
      if (snapshot && room) room.metrics.recordSnapshotSerialization(performance.now() - started, serialized.bytes);
    }
    if (snapshot) outbound.snapshotInFlight = true;
    const callbackStarted = performance.now();
    try {
      socket.send(serialized.text, () => {
        room?.metrics.recordSendCallback(performance.now() - callbackStarted);
        if (!snapshot) return;
        const current = this.outboundStates.get(connectionId);
        if (!current) return;
        current.snapshotInFlight = false;
        this.flushPendingSnapshot(connectionId);
      });
      if (room) {
        room.metrics.sentBytes += serialized.bytes;
        room.metrics.observeBufferedAmount(socket.bufferedAmount);
        if (snapshot) room.metrics.snapshotSentCount += 1;
      }
    } catch (error) {
      if (snapshot) outbound.snapshotInFlight = false;
      console.warn(JSON.stringify({ level: 'warn', event: 'socket_send_failed', connectionId, detail: error instanceof Error ? error.message : 'unknown error' }));
    }
  }

  /** callback 또는 다음 publish에서 송신 큐가 회복됐으면 보관된 최신 snapshot만 전송한다. */
  private flushPendingSnapshot(connectionId: string): void {
    const socket = this.sockets.get(connectionId);
    const outbound = this.outboundStates.get(connectionId);
    if (!socket || !outbound || socket.readyState !== WebSocket.OPEN || outbound.snapshotInFlight || !outbound.pendingSnapshot) return;
    const room = this.roomFor(connectionId);
    room?.metrics.observeBufferedAmount(socket.bufferedAmount);
    if (socket.bufferedAmount > snapshotBackpressureBytes) return;
    const pending = outbound.pendingSnapshot;
    outbound.pendingSnapshot = null;
    this.sendSerialized(connectionId, pending, true);
  }

  /** connection의 현재 Room을 조회해 transport 측정값을 권위 Room metrics에 연결한다. */
  private roomFor(connectionId: string) {
    const roomId = this.sessions.get(connectionId)?.roomId;
    return roomId ? this.rooms.rooms.get(roomId) : undefined;
  }

  /** 연결을 유지한 채 구조화된 서버 오류 코드를 클라이언트에 알린다. */
  private reject(socket: WebSocket, code: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope('S2C_ERROR', { code })));
  }

  /** 연결 종료를 Room의 grace-period 상태로 반영하고 제거 가능한 Room을 정리한다. */
  private onClose(connectionId: string): void {
    const session = this.sessions.get(connectionId);
    if (session?.roomId && session.playerId) this.rooms.rooms.get(session.roomId)?.disconnect(session.playerId, connectionId);
    this.sockets.delete(connectionId);
    this.sessions.delete(connectionId);
    this.outboundStates.delete(connectionId);
    this.rooms.cleanup();
  }

  /** 새 연결 수락을 중단하며 각 Room의 생명주기는 호출자가 별도로 종료한다. */
  close(): void { this.webSocketServer.close(); }
}

/** 운영 상태와 Room별 tick/트래픽 지표만 노출하는 경량 HTTP endpoint를 만든다. */
export function createHealthServer(rooms: RoomManager, metricsToken: string | null = null): HttpServer {
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/health') {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    if (pathname === '/metrics') {
      if (!isMetricsAuthorized(request.headers.authorization, metricsToken)) {
        response.statusCode = 401;
        response.setHeader('www-authenticate', 'Bearer');
        response.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
        return;
      }
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({
        eventLoop: { p95Ms: eventLoopDelay.percentile(95) / 1_000_000, maxMs: eventLoopDelay.max / 1_000_000 },
        rooms: [...rooms.rooms.values()].map((room) => ({ roomId: room.id, phase: room.phase, players: room.players.size, ...room.metrics.snapshot() }))
      }));
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (serveStatic(request.url, response)) return;
    }
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  server.on('close', () => eventLoopDelay.disable());
  return server;
}
