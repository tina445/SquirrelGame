import { randomBytes } from 'node:crypto';
import { gameBalance, randomMapSeed, type PlayerId, type Team } from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../simulation/matchRoom.js';

export class RoomManager {
  readonly rooms = new Map<string, MatchRoom>();

  /** 고유 코드와 seed를 가진 독립 권위 시뮬레이션 단위를 생성해 registry에 등록한다. */
  createRoom(code = randomBytes(3).toString('hex').toUpperCase(), seed = randomMapSeed()): MatchRoom {
    if (this.rooms.has(code)) throw new Error('ROOM_CODE_EXISTS');
    const room = new MatchRoom({ id: code, seed });
    this.rooms.set(code, room);
    return room;
  }

  /** 명시 Room 또는 첫 입장 가능한 로비를 선택하고, 없으면 새 Room을 만들어 플레이어를 배정한다. */
  join(roomCode: string | undefined, connection: RoomConnection, displayName: string, preferredTeam?: Team): { room: MatchRoom; playerId: PlayerId } {
    const room = roomCode ? this.rooms.get(roomCode) : [...this.rooms.values()].find((candidate) => candidate.phase === 'LOBBY' && candidate.players.size < gameBalance.teamSize * 2) ?? this.createRoom();
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const player = room.addPlayer(connection, displayName, preferredTeam);
    return { room, playerId: player.id };
  }

  /** 종료·실패한 Room 중 활성 연결이 없는 인스턴스만 registry에서 제거한다. */
  cleanup(): void {
    for (const [id, room] of this.rooms) if ((room.phase === 'FINISHED' || room.phase === 'CLOSED') && room.connections.size === 0) this.rooms.delete(id);
  }
}
