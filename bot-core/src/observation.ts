import {
  distanceSquared, lineOfSight, movementCircleColliders,
  type MapDefinition, type PlayerId, type WorldSnapshot
} from '@squirrel-heist/shared';
import type { BotObservation, ObservedOpponent } from './types.js';

export const botPerceptionRadius = 18;
export const botMemoryMs = 2_000;

export class BotPerception {
  private readonly lastSeen = new Map<PlayerId, ObservedOpponent>();

  /** 서버 전체 snapshot을 사람과 유사한 거리·시야 관측과 짧은 기억으로 축소한다. */
  observe(map: MapDefinition, snapshot: WorldSnapshot, selfId: PlayerId): BotObservation {
    const self = snapshot.players.find((player) => player.id === selfId);
    if (!self) throw new Error('BOT_SELF_NOT_FOUND');
    const blockers = movementCircleColliders(map);
    const opponents = snapshot.players.filter((player) => player.team !== self.team && player.team !== null);
    for (const opponent of opponents) {
      const visible = opponent.mode !== 'JAILED' && distanceSquared(self.position, opponent.position) <= botPerceptionRadius ** 2 &&
        lineOfSight(self.position, opponent.position, map.staticColliders, blockers);
      if (visible) this.lastSeen.set(opponent.id, { ...opponent, observedAtMs: snapshot.serverTimeMs, visible: true });
    }
    for (const [id, remembered] of this.lastSeen) {
      if (snapshot.serverTimeMs - remembered.observedAtMs > botMemoryMs || !opponents.some((player) => player.id === id)) this.lastSeen.delete(id);
      else if (remembered.observedAtMs !== snapshot.serverTimeMs) this.lastSeen.set(id, { ...remembered, visible: false });
    }
    const visiblePoint = (position: { x: number; y: number }): boolean =>
      distanceSquared(self.position, position) <= botPerceptionRadius ** 2 && lineOfSight(self.position, position, map.staticColliders, blockers);
    const acorns = snapshot.acorns.filter((acorn) => {
      if (acorn.location.kind === 'CARRIED') {
        const carrierId = acorn.location.carrierId;
        return carrierId === self.id || snapshot.players.some((player) => player.id === carrierId && player.team === self.team);
      }
      if (acorn.location.kind === 'GROUND') return visiblePoint(acorn.location.position);
      return false;
    });
    const storageAcornCounts = Object.fromEntries(map.storages.map((storage) => [storage.id,
      snapshot.acorns.filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id).length]));
    return {
      map, phase: snapshot.phase, nowMs: snapshot.serverTimeMs, remainingMs: snapshot.remainingMs, self,
      teammates: snapshot.players.filter((player) => player.id !== self.id && player.team === self.team),
      opponents: [...this.lastSeen.values()], acorns, berries: snapshot.berries.filter((berry) => visiblePoint(berry.position)),
      storageAcornCounts, thiefSecuredCount: snapshot.thiefSecuredCount
    };
  }
}
