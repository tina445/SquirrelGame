import WebSocket from 'ws';
import {
  InputButton,
  envelope,
  fixedDeltaMs,
  gameBalance,
  protocolVersion,
  type ClientMessage,
  type ServerMessage,
  type Team,
  type WorldSnapshot
} from '@squirrel-heist/shared';

const url = process.env.LOAD_WS_URL ?? 'ws://127.0.0.1:8080';
const botCount = positiveInteger('LOAD_BOTS', 80);
const durationMs = positiveInteger('LOAD_DURATION_MS', 30_000);
const roomSize = positiveInteger('LOAD_ROOM_SIZE', gameBalance.teamSize * 2);
const connectTimeoutMs = positiveInteger('LOAD_CONNECT_TIMEOUT_MS', 30_000);

interface LoadClient {
  index: number;
  roomIndex: number;
  roomSlot: number;
  socket: WebSocket;
  roomId: string | null;
  playerId: string | null;
  open: boolean;
  assetsReady: boolean;
  playing: boolean;
  sequence: number;
  tick: number;
  inputTimer: NodeJS.Timeout | null;
  latestSnapshot: WorldSnapshot | null;
  snapshotTimes: number[];
  snapshotBytes: number[];
  errors: string[];
  closeCode: number | null;
  closeReason: string | null;
}

interface ClientSummary {
  index: number;
  roomId: string | null;
  playerId: string | null;
  snapshots: number;
  snapshotHz: number;
  snapshotTotalBytes: number;
  snapshotAverageBytes: number;
  snapshotP95Bytes: number;
  interarrivalAverageMs: number;
  interarrivalP95Ms: number;
  interarrivalMaxMs: number;
  errors: string[];
  closeCode: number | null;
  closeReason: string | null;
}

let recording = false;
const clients: LoadClient[] = [];

/** 양의 정수 환경변수만 허용해 잘못된 부하 조건을 조용히 실행하지 않는다. */
function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name}_MUST_BE_A_POSITIVE_INTEGER`);
  return parsed;
}

/** 정렬된 표본의 nearest-rank 백분위 값을 반환한다. */
function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

/** 조건이 충족될 때까지 짧게 polling하고 설정 오류나 서버 정지를 timeout으로 드러낸다. */
async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt >= connectTimeoutMs) throw new Error(`TIMEOUT_WAITING_FOR_${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** 현재 연결에 공통 프로토콜 envelope를 적용하고 OPEN 상태에서만 전송한다. */
function send(client: LoadClient, message: ClientMessage): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  client.socket.send(JSON.stringify(message));
}

/** FRIEND_ROOM의 슬롯을 경찰/도둑 절반씩 배치해 서버의 4:4 시작 조건을 재현한다. */
function roleFor(client: LoadClient): Team {
  return client.roomSlot < roomSize / 2 ? 'POLICE' : 'THIEF';
}

/** 소켓 하나를 만들고 입장·맵 준비·역할 선택·측정 수집·오류 관측을 연결한다. */
function createClient(index: number, roomIndex: number, roomSlot: number, joinMode: 'CREATE_ROOM' | 'JOIN_ROOM', roomCode?: string): LoadClient {
  const socket = new WebSocket(url);
  const client: LoadClient = {
    index,
    roomIndex,
    roomSlot,
    socket,
    roomId: null,
    playerId: null,
    open: false,
    assetsReady: false,
    playing: false,
    sequence: 0,
    tick: 0,
    inputTimer: null,
    latestSnapshot: null,
    snapshotTimes: [],
    snapshotBytes: [],
    errors: [],
    closeCode: null,
    closeReason: null
  };
  clients.push(client);

  socket.on('open', () => {
    client.open = true;
    send(client, envelope('C2S_JOIN_ROOM', {
      joinMode,
      ...(roomCode === undefined ? {} : { roomCode }),
      displayName: `load-bot-${index}`,
      clientVersion: 'load-2'
    }) as ClientMessage);
  });
  socket.on('message', (raw) => {
    const text = raw.toString();
    let message: ServerMessage;
    try { message = JSON.parse(text) as ServerMessage; }
    catch (error) {
      client.errors.push(`INVALID_JSON:${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (message.protocolVersion !== protocolVersion) {
      client.errors.push(`PROTOCOL_MISMATCH:${message.protocolVersion}`);
      return;
    }
    switch (message.type) {
      case 'S2C_JOINED_ROOM':
        client.roomId = message.payload.roomId;
        client.playerId = message.payload.playerId;
        break;
      case 'S2C_MAP_DEFINITION':
        send(client, envelope('C2S_CLIENT_READY', { mapHash: message.payload.mapHash, assetsReady: true }, message.roomId) as ClientMessage);
        send(client, envelope('C2S_SET_ROLE_PREFERENCE', { rolePreference: roleFor(client) }, message.roomId) as ClientMessage);
        send(client, envelope('C2S_SET_READY', { ready: true }, message.roomId) as ClientMessage);
        client.assetsReady = true;
        break;
      case 'S2C_MATCH_PHASE':
        if (message.payload.phase === 'PLAYING') client.playing = true;
        break;
      case 'S2C_WORLD_SNAPSHOT':
        client.latestSnapshot = message.payload;
        if (message.payload.phase === 'PLAYING') client.playing = true;
        if (recording) {
          client.snapshotTimes.push(performance.now());
          client.snapshotBytes.push(Buffer.byteLength(text));
        }
        break;
      case 'S2C_ERROR':
        client.errors.push(`SERVER:${message.payload.code}${message.payload.detail ? `:${message.payload.detail}` : ''}`);
        break;
      default:
        break;
    }
  });
  socket.on('error', (error) => client.errors.push(`SOCKET:${error.message}`));
  socket.on('close', (code, reason) => {
    client.closeCode = code;
    client.closeReason = reason.toString();
  });
  return client;
}

/** 모든 방장이 각 방의 정확한 인원·역할·준비 상태를 관측한 뒤 한 번씩 시작을 요청한다. */
async function startRooms(hosts: LoadClient[]): Promise<void> {
  await waitUntil(() => hosts.every((host) => {
    const players = host.latestSnapshot?.players ?? [];
    return players.length === roomSize && players.every((player) => player.assetsReady && player.ready && player.rolePreference !== null);
  }), 'ROOMS_READY');
  for (const host of hosts) send(host, envelope('C2S_START_MATCH', {}, host.roomId ?? undefined) as ClientMessage);
  await waitUntil(() => clients.every((client) => client.playing), 'ROOMS_PLAYING');
}

/** PLAYING 동안 20Hz 입력을 보내 서버의 정상적인 입력 처리와 outbound snapshot 부하를 함께 측정한다. */
function startInputs(): void {
  for (const client of clients) {
    client.inputTimer = setInterval(() => {
      const angle = client.tick / 25 + client.index;
      const buttons = client.tick % 80 === 0 ? InputButton.ACORN : client.tick % 120 === 0 ? InputButton.FIRE : 0;
      send(client, envelope('C2S_INPUT', {
        sequence: client.sequence++,
        clientTick: client.tick++,
        moveX: Math.cos(angle),
        moveY: Math.sin(angle),
        aimX: Math.cos(angle),
        aimY: Math.sin(angle),
        buttons
      }, client.roomId ?? undefined) as ClientMessage);
    }, fixedDeltaMs);
  }
}

/** 의도한 종료 code를 전송하고 close 관측을 잠시 기다려 결과 JSON에 연결 종료 상태를 포함한다. */
async function closeClients(): Promise<void> {
  for (const client of clients) {
    if (client.inputTimer) clearInterval(client.inputTimer);
    if (client.socket.readyState === WebSocket.OPEN) client.socket.close(1000, 'load_complete');
    else if (client.socket.readyState === WebSocket.CONNECTING) client.socket.terminate();
  }
  const startedAt = performance.now();
  while (clients.some((client) => client.closeCode === null) && performance.now() - startedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** 연결별 수치와 전체 수치를 모두 남겨 회귀와 편차를 한 JSON으로 비교할 수 있게 한다. */
function summarize(elapsedMs: number, expectedRooms: number): { clients: ClientSummary[]; aggregate: Record<string, unknown>; rooms: Record<string, number> } {
  const summaries = clients.map<ClientSummary>((client) => {
    const gaps = client.snapshotTimes.slice(1).map((time, index) => time - (client.snapshotTimes[index] ?? time));
    const totalBytes = client.snapshotBytes.reduce((sum, value) => sum + value, 0);
    return {
      index: client.index,
      roomId: client.roomId,
      playerId: client.playerId,
      snapshots: client.snapshotBytes.length,
      snapshotHz: client.snapshotBytes.length / (elapsedMs / 1_000),
      snapshotTotalBytes: totalBytes,
      snapshotAverageBytes: client.snapshotBytes.length === 0 ? 0 : totalBytes / client.snapshotBytes.length,
      snapshotP95Bytes: percentile(client.snapshotBytes, 0.95),
      interarrivalAverageMs: gaps.length === 0 ? 0 : gaps.reduce((sum, value) => sum + value, 0) / gaps.length,
      interarrivalP95Ms: percentile(gaps, 0.95),
      interarrivalMaxMs: gaps.length === 0 ? 0 : Math.max(...gaps),
      errors: client.errors,
      closeCode: client.closeCode,
      closeReason: client.closeReason
    };
  });
  const allSnapshotBytes = clients.flatMap((client) => client.snapshotBytes);
  const allGaps = clients.flatMap((client) => client.snapshotTimes.slice(1).map((time, index) => time - (client.snapshotTimes[index] ?? time)));
  const totalBytes = allSnapshotBytes.reduce((sum, value) => sum + value, 0);
  const roomCounts = Object.fromEntries([...new Set(clients.map((client) => client.roomId).filter((roomId): roomId is string => roomId !== null))]
    .sort()
    .map((roomId) => [roomId, clients.filter((client) => client.roomId === roomId).length]));
  return {
    clients: summaries,
    rooms: roomCounts,
    aggregate: {
      connected: clients.filter((client) => client.open).length,
      assetsReady: clients.filter((client) => client.assetsReady).length,
      playing: clients.filter((client) => client.playing).length,
      observedRooms: Object.keys(roomCounts).length,
      expectedRooms,
      roomSizesMatch: Object.keys(roomCounts).length === expectedRooms && Object.values(roomCounts).every((count) => count === roomSize),
      clientsWithErrors: summaries.filter((client) => client.errors.length > 0).length,
      snapshots: allSnapshotBytes.length,
      snapshotHzAverage: summaries.reduce((sum, client) => sum + client.snapshotHz, 0) / summaries.length,
      snapshotHzMin: Math.min(...summaries.map((client) => client.snapshotHz)),
      snapshotHzMax: Math.max(...summaries.map((client) => client.snapshotHz)),
      expectedSnapshotHz: gameBalance.snapshotRate,
      snapshotRateMatch: summaries.every((client) => Math.abs(client.snapshotHz - gameBalance.snapshotRate) <= 0.5),
      snapshotTotalBytes: totalBytes,
      snapshotBytesPerSecond: totalBytes / (elapsedMs / 1_000),
      snapshotAverageBytes: allSnapshotBytes.length === 0 ? 0 : totalBytes / allSnapshotBytes.length,
      snapshotP95Bytes: percentile(allSnapshotBytes, 0.95),
      interarrivalAverageMs: allGaps.length === 0 ? 0 : allGaps.reduce((sum, value) => sum + value, 0) / allGaps.length,
      interarrivalP95Ms: percentile(allGaps, 0.95),
      interarrivalMaxMs: allGaps.length === 0 ? 0 : Math.max(...allGaps),
      closeCodes: Object.fromEntries([...new Set(summaries.map((client) => client.closeCode))].map((code) => [String(code), summaries.filter((client) => client.closeCode === code).length])),
      normalClose: summaries.every((client) => client.closeCode === 1000)
    }
  };
}

async function main(): Promise<void> {
  if (roomSize !== gameBalance.teamSize * 2) throw new Error(`LOAD_ROOM_SIZE_MUST_EQUAL_SERVER_MATCH_SIZE_${gameBalance.teamSize * 2}`);
  if (botCount % roomSize !== 0) throw new Error('LOAD_BOTS_MUST_BE_DIVISIBLE_BY_LOAD_ROOM_SIZE');
  const expectedRooms = botCount / roomSize;
  const hosts = Array.from({ length: expectedRooms }, (_, roomIndex) => createClient(roomIndex * roomSize, roomIndex, 0, 'CREATE_ROOM'));
  await waitUntil(() => hosts.every((host) => host.roomId !== null && host.assetsReady), 'ROOM_HOSTS');
  for (const host of hosts) {
    for (let roomSlot = 1; roomSlot < roomSize; roomSlot += 1) {
      createClient(host.roomIndex * roomSize + roomSlot, host.roomIndex, roomSlot, 'JOIN_ROOM', host.roomId ?? undefined);
    }
  }
  await waitUntil(() => clients.length === botCount && clients.every((client) => client.roomId !== null && client.assetsReady), 'ALL_CLIENTS');
  await startRooms(hosts);
  startInputs();
  const startedAt = new Date().toISOString();
  const startedMono = performance.now();
  recording = true;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  recording = false;
  const elapsedMs = performance.now() - startedMono;
  await closeClients();
  const result = summarize(elapsedMs, expectedRooms);
  const success = result.aggregate.connected === botCount &&
    result.aggregate.playing === botCount &&
    result.aggregate.roomSizesMatch === true &&
    result.aggregate.clientsWithErrors === 0 &&
    result.aggregate.snapshotRateMatch === true &&
    result.aggregate.normalClose === true;
  const output = {
    result: success ? 'PASS' : 'FAIL',
    processExitCode: success ? 0 : 1,
    startedAt,
    url,
    protocolVersion,
    mode: 'FRIEND_ROOM',
    requestedBots: botCount,
    roomSize,
    durationMs,
    elapsedMs,
    aggregate: result.aggregate,
    rooms: result.rooms,
    clients: result.clients
  };
  console.log(JSON.stringify(output));
  if (!success) process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  recording = false;
  await closeClients();
  console.log(JSON.stringify({
    result: 'FAIL',
    processExitCode: 1,
    url,
    protocolVersion,
    mode: 'FRIEND_ROOM',
    requestedBots: botCount,
    roomSize,
    durationMs,
    error: error instanceof Error ? error.message : String(error),
    clients: clients.map((client) => ({ index: client.index, roomId: client.roomId, errors: client.errors, closeCode: client.closeCode, closeReason: client.closeReason }))
  }));
  process.exitCode = 1;
});
