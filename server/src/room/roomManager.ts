import { randomBytes } from 'node:crypto';
import { gameBalance, randomMapSeed, type JoinRoomMode, type PlayerId, type RolePreference } from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../simulation/matchRoom.js';

export class RoomManager {
  readonly rooms = new Map<string, MatchRoom>();

  /** 고유 코드와 seed를 가진 독립 권위 시뮬레이션 단위를 생성해 공개 매칭 여부와 함께 등록한다. */
  createRoom(code = this.createRoomCode(), seed = randomMapSeed(), listed = true): MatchRoom {
    if (this.rooms.has(code)) throw new Error('ROOM_CODE_EXISTS');
    const room = new MatchRoom({ id: code, seed, listed });
    this.rooms.set(code, room);
    return room;
  }

  /** 빠른 매칭·비공개 생성·코드 참가를 분리하고 선택된 Room에서만 랜덤 역할 배정을 수행한다. */
  join(mode: JoinRoomMode, roomCode: string | undefined, connection: RoomConnection, displayName: string, rolePreference?: RolePreference): { room: MatchRoom; playerId: PlayerId } {
    const normalizedCode = roomCode?.trim().toUpperCase();
    const room = mode === 'CREATE_ROOM'
      ? this.createRoom(undefined, undefined, false)
      : mode === 'JOIN_ROOM'
        ? (normalizedCode ? this.rooms.get(normalizedCode) : undefined)
        : [...this.rooms.values()].find((candidate) => candidate.listed && candidate.phase === 'LOBBY' && candidate.players.size < gameBalance.teamSize * 2 && candidate.canAcceptRole(rolePreference ?? 'RANDOM')) ?? this.createRoom();
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const player = room.addPlayer(connection, displayName, mode === 'QUICK_MATCH' ? rolePreference ?? 'RANDOM' : null);
    return { room, playerId: player.id };
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
      const empty = room.players.size === 0;
      if (room.connections.size === 0 && (empty || room.phase === 'FINISHED' || room.phase === 'CLOSED')) this.rooms.delete(id);
    }
  }
}
