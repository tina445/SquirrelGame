import { randomBytes } from 'node:crypto';
import { gameBalance, randomMapSeed, type JoinRoomMode, type LobbyKind, type PlayerId, type RolePreference } from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../simulation/matchRoom.js';

export interface RoomManagerOptions {
  maxPlayers?: number;
  botFillDelayMs?: number;
}

export class RoomManager {
  readonly rooms = new Map<string, MatchRoom>();
  private readonly quickMatchQueuedAtMs = new Map<string, number>();

  constructor(private readonly options: RoomManagerOptions = {}) {}

  /** 모든 Room의 연결·재접속 유예 슬롯을 합산해 공개 서버의 전역 정원을 판정한다. */
  playerCount(): number { return [...this.rooms.values()].reduce((count, room) => count + room.players.size, 0); }

  /** 고유 코드와 seed를 가진 독립 권위 시뮬레이션 단위를 생성해 공개 매칭 여부와 함께 등록한다. */
  createRoom(code = this.createRoomCode(), seed = randomMapSeed(), lobbyKind: LobbyKind = 'QUICK_MATCH'): MatchRoom {
    if (this.rooms.has(code)) throw new Error('ROOM_CODE_EXISTS');
    const room = new MatchRoom({ id: code, seed, lobbyKind });
    this.rooms.set(code, room);
    return room;
  }

  /** 빠른 매칭·비공개 생성·코드 참가를 분리하고 선택된 Room에서만 랜덤 역할 배정을 수행한다. */
  join(mode: JoinRoomMode, roomCode: string | undefined, connection: RoomConnection, displayName: string, rolePreference?: RolePreference): { room: MatchRoom; playerId: PlayerId } {
    if (this.playerCount() >= (this.options.maxPlayers ?? Number.POSITIVE_INFINITY)) throw new Error('SERVER_FULL');
    const normalizedCode = roomCode?.trim().toUpperCase();
    const room = mode === 'CREATE_ROOM'
      ? this.createRoom(undefined, undefined, 'FRIEND_ROOM')
      : mode === 'JOIN_ROOM'
        ? (normalizedCode ? this.rooms.get(normalizedCode) : undefined)
        : [...this.rooms.values()].find((candidate) => candidate.listed && candidate.phase === 'LOBBY' && candidate.players.size < gameBalance.teamSize * 2 && candidate.canAcceptRole(rolePreference ?? 'RANDOM')) ?? this.createRoom();
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const player = room.addPlayer(connection, displayName, mode === 'QUICK_MATCH' ? rolePreference ?? 'RANDOM' : null);
    if (mode === 'QUICK_MATCH') this.quickMatchQueuedAtMs.set(room.id, Date.now());
    return { room, playerId: player.id };
  }

  /** 일정 시간 사람이 부족한 공개 빠른 매칭만 8명으로 채운다. bot도 실제 슬롯을 차지하므로 전역 공개 정원에 남은 자리가 충분할 때만 투입한다. */
  fillQuickMatchBots(nowMs = Date.now()): void {
    const delayMs = this.options.botFillDelayMs ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(delayMs)) return;
    const capacity = this.options.maxPlayers ?? Number.POSITIVE_INFINITY;
    for (const room of this.rooms.values()) {
      if (room.lobbyKind !== 'QUICK_MATCH' || room.phase !== 'LOBBY' || room.players.size === 0) {
        this.quickMatchQueuedAtMs.delete(room.id);
        continue;
      }
      const queuedAtMs = this.quickMatchQueuedAtMs.get(room.id) ?? nowMs;
      this.quickMatchQueuedAtMs.set(room.id, queuedAtMs);
      const missingPlayers = gameBalance.teamSize * 2 - room.players.size;
      if (nowMs - queuedAtMs < delayMs || missingPlayers <= 0 || this.playerCount() + missingPlayers > capacity) continue;
      for (let index = 0; index < missingPlayers; index += 1) room.addTestBot(`테스트 봇 ${room.testBotPlayerCount + 1}`);
      this.quickMatchQueuedAtMs.delete(room.id);
      console.info(JSON.stringify({ level: 'info', event: 'quick_match_bots_added', roomId: room.id, botCount: room.testBotPlayerCount }));
    }
  }

  /** 충돌 없는 6자리 대문자 코드를 제한된 Room registry 안에서 생성한다. */
  private createRoomCode(): string {
    let code: string;
    do code = randomBytes(3).toString('hex').toUpperCase(); while (this.rooms.has(code));
    return code;
  }

  /** 종료 Room 또는 명시적 이탈로 인원이 0이 된 Room을 활성 연결이 없을 때 registry에서 제거한다. */
  cleanup(): void {
    for (const [id, room] of this.rooms) {
      if (room.testBotPlayerCount > 0 && !room.hasLiveOrReconnectableHuman()) room.removeTestBots();
      const empty = room.players.size === 0;
      if (room.connections.size === 0 && (empty || room.phase === 'FINISHED' || room.phase === 'CLOSED')) {
        this.rooms.delete(id);
        this.quickMatchQueuedAtMs.delete(id);
      }
    }
  }
}
