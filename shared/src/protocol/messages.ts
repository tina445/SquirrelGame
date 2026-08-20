import type { InputCommand, MapDefinition, MatchEndReason, MatchPhase, Team, WorldSnapshot, GameEvent } from '../domain/types.js';

export const protocolVersion = 1;
export interface MessageEnvelope<TType extends string = string, TPayload = unknown> {
  type: TType;
  protocolVersion: number;
  roomId?: string;
  requestId?: string;
  payload: TPayload;
}

export type ClientMessage =
  | MessageEnvelope<'C2S_JOIN_ROOM', { roomCode?: string; displayName: string; preferredTeam?: Team; clientVersion: string; reconnectToken?: string }>
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

export function envelope<TType extends ServerMessage['type'], TPayload>(type: TType, payload: TPayload, roomId?: string): MessageEnvelope<TType, TPayload> {
  return roomId === undefined ? { type, protocolVersion, payload } : { type, protocolVersion, roomId, payload };
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== protocolVersion || typeof message.type !== 'string' || !message.payload || typeof message.payload !== 'object') return null;
  const payload = message.payload as Record<string, unknown>;
  switch (message.type) {
    case 'C2S_JOIN_ROOM':
      return typeof payload.displayName === 'string' && payload.displayName.trim().length > 0 && payload.displayName.length <= 24 && typeof payload.clientVersion === 'string' ? value as ClientMessage : null;
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

export function isValidInput(value: Record<string, unknown>): boolean {
  const finite = (key: string): boolean => typeof value[key] === 'number' && Number.isFinite(value[key]);
  return finite('sequence') && Number.isInteger(value.sequence) && (value.sequence as number) >= 0 &&
    finite('clientTick') && Number.isInteger(value.clientTick) &&
    ['moveX', 'moveY', 'aimX', 'aimY'].every(finite) &&
    Math.abs(value.moveX as number) <= 1 && Math.abs(value.moveY as number) <= 1 &&
    Math.abs(value.aimX as number) <= 1 && Math.abs(value.aimY as number) <= 1 &&
    finite('buttons') && Number.isInteger(value.buttons) && (value.buttons as number) >= 0 && (value.buttons as number) <= 7;
}
