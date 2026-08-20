import { randomBytes } from 'node:crypto';
import { randomMapSeed, type PlayerId, type Team } from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../simulation/matchRoom.js';

export class RoomManager {
  readonly rooms = new Map<string, MatchRoom>();

  createRoom(code = randomBytes(3).toString('hex').toUpperCase(), seed = randomMapSeed()): MatchRoom {
    if (this.rooms.has(code)) throw new Error('ROOM_CODE_EXISTS');
    const room = new MatchRoom({ id: code, seed });
    this.rooms.set(code, room);
    return room;
  }

  join(roomCode: string | undefined, connection: RoomConnection, displayName: string, preferredTeam?: Team): { room: MatchRoom; playerId: PlayerId } {
    const room = roomCode ? this.rooms.get(roomCode) : [...this.rooms.values()].find((candidate) => candidate.phase === 'LOBBY') ?? this.createRoom();
    if (!room) throw new Error('ROOM_NOT_FOUND');
    const player = room.addPlayer(connection, displayName, preferredTeam);
    return { room, playerId: player.id };
  }

  cleanup(): void {
    for (const [id, room] of this.rooms) if ((room.phase === 'FINISHED' || room.phase === 'CLOSED') && room.connections.size === 0) this.rooms.delete(id);
  }
}
