import type { GameEvent, InputCommand, JoinRoomMode, MapDefinition, MatchEndReason, MatchPhase, Team, WorldSnapshot } from '../domain/types.js';

export const protocolVersion = 2;
export interface MessageEnvelope<TType extends string = string, TPayload = unknown> {
  type: TType;
  protocolVersion: number;
  roomId?: string;
  requestId?: string;
  payload: TPayload;
}

export type ClientMessage =
  | MessageEnvelope<'C2S_JOIN_ROOM', { joinMode?: JoinRoomMode; roomCode?: string; displayName: string; clientVersion: string; reconnectToken?: string }>
  | MessageEnvelope<'C2S_CLIENT_READY', { mapHash: string; assetsReady: boolean }>
  | MessageEnvelope<'C2S_INPUT', InputCommand>
  | MessageEnvelope<'C2S_PING', { clientTimeMs: number }>
  | MessageEnvelope<'C2S_REQUEST_RESYNC', Record<string, never>>;

export type ServerMessage =
  | MessageEnvelope<'S2C_JOINED_ROOM', { playerId: string; team: Team; roomId: string; phase: MatchPhase; reconnectToken: string }>
  | MessageEnvelope<'S2C_MAP_DEFINITION', { mapSeed: string; generatorVersion: number; map: MapDefinition; mapHash: string }>
  | MessageEnvelope<'S2C_MATCH_PHASE', { phase: MatchPhase; winner: Team | null; reason: MatchEndReason | null; countdownEndsAtMs?: number }>
  | MessageEnvelope<'S2C_WORLD_SNAPSHOT', WorldSnapshot>
  | MessageEnvelope<'S2C_GAME_EVENTS', { events: GameEvent[] }>
  | MessageEnvelope<'S2C_FULL_STATE', { map: MapDefinition; snapshot: WorldSnapshot }>
  | MessageEnvelope<'S2C_PONG', { clientTimeMs: number; serverTimeMs: number }>
  | MessageEnvelope<'S2C_ERROR', { code: string; detail?: string }>;

/** 모든 메시지에 현재 프로토콜 버전과 선택적 Room 식별자를 일관되게 붙인다. */
export function envelope<TType extends ClientMessage['type'] | ServerMessage['type'], TPayload>(type: TType, payload: TPayload, roomId?: string): MessageEnvelope<TType, TPayload> {
  return roomId === undefined ? { type, protocolVersion, payload } : { type, protocolVersion, roomId, payload };
}

/** 신뢰할 수 없는 클라이언트 JSON을 파싱하고 메시지별 최소 런타임 스키마를 통과한 값만 반환한다. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== protocolVersion || typeof message.type !== 'string' || !message.payload || typeof message.payload !== 'object') return null;
  const payload = message.payload as Record<string, unknown>;
  switch (message.type) {
    case 'C2S_JOIN_ROOM':
      if (typeof payload.displayName !== 'string' || payload.displayName.trim().length === 0 || payload.displayName.length > 24 || typeof payload.clientVersion !== 'string') return null;
      if (payload.joinMode !== undefined && !['QUICK_MATCH', 'CREATE_ROOM', 'JOIN_ROOM'].includes(payload.joinMode as string)) return null;
      if (payload.roomCode !== undefined && (typeof payload.roomCode !== 'string' || !/^[A-Za-z0-9]{4,8}$/.test(payload.roomCode))) return null;
      if (payload.joinMode === 'JOIN_ROOM' && typeof payload.roomCode !== 'string') return null;
      return value as ClientMessage;
    case 'C2S_CLIENT_READY':
      return typeof payload.mapHash === 'string' && typeof payload.assetsReady === 'boolean' ? value as ClientMessage : null;
    case 'C2S_INPUT':
      return isValidInput(payload) ? value as ClientMessage : null;
    case 'C2S_PING':
      return typeof payload.clientTimeMs === 'number' ? value as ClientMessage : null;
    case 'C2S_REQUEST_RESYNC':
      return value as ClientMessage;
    default:
      return null;
  }
}

/** 입력 sequence·축·버튼의 수치 범위를 검증해 서버 권위 시뮬레이션에 비정상 값을 넣지 않는다. */
export function isValidInput(value: Record<string, unknown>): boolean {
  const finite = (key: string): boolean => typeof value[key] === 'number' && Number.isFinite(value[key]);
  return finite('sequence') && Number.isInteger(value.sequence) && (value.sequence as number) >= 0 &&
    finite('clientTick') && Number.isInteger(value.clientTick) &&
    ['moveX', 'moveY', 'aimX', 'aimY'].every(finite) &&
    Math.abs(value.moveX as number) <= 1 && Math.abs(value.moveY as number) <= 1 &&
    Math.abs(value.aimX as number) <= 1 && Math.abs(value.aimY as number) <= 1 &&
    finite('buttons') && Number.isInteger(value.buttons) && (value.buttons as number) >= 0 && (value.buttons as number) <= 7;
}
