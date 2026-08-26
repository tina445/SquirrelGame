import {
  distanceSquared, gameBalance, lineOfSight, movementCircleColliders,
  type MapDefinition, type PlayerId, type WorldSnapshot
} from '@squirrel-heist/shared';
import type { BotObservation, ObservedOpponent } from './types.js';

export const botPerceptionRadius = 18;
export const botMemoryMs = 2_000;

export class BotPerception {
  private readonly lastSeen = new Map<PlayerId, ObservedOpponent>();
  private recentThunderHit: import('./types.js').RecentThunderHit | null = null;

  /** 서버 snapshot을 근거리 전술 시야와 사람이 미니맵에서 보는 공개 자원 정보로 분리한다. */
  observe(map: MapDefinition, snapshot: WorldSnapshot, selfId: PlayerId): BotObservation {
    const self = snapshot.players.find((player) => player.id === selfId);
    if (!self) throw new Error('BOT_SELF_NOT_FOUND');
    const blockers = movementCircleColliders(map);
    const opponents = snapshot.players.filter((player) => player.team !== self.team && player.team !== null);
    const ownHit = snapshot.thunderEffects.find((effect) => effect.ownerId === selfId && effect.hitPlayerId !== null);
    if (ownHit?.hitPlayerId) {
      const target = snapshot.players.find((player) => player.id === ownHit.hitPlayerId);
      if (target) this.recentThunderHit = { targetId: target.id, position: { ...target.position }, expiresAtMs: snapshot.serverTimeMs + gameBalance.thunderStunMs };
    }
    if (this.recentThunderHit && snapshot.serverTimeMs > this.recentThunderHit.expiresAtMs) this.recentThunderHit = null;
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
    const teammateIds = new Set(snapshot.players.filter((player) => player.team === self.team).map((player) => player.id));
    const minimapCarriers = snapshot.acorns.flatMap((acorn) => {
      const location = acorn.location;
      if (location.kind !== 'CARRIED' || teammateIds.has(location.carrierId)) return [];
      const carrier = snapshot.players.find((player) => player.id === location.carrierId);
      return carrier ? [{ playerId: carrier.id, position: carrier.position }] : [];
    });
    return {
      map, phase: snapshot.phase, nowMs: snapshot.serverTimeMs, remainingMs: snapshot.remainingMs, self,
      teammates: snapshot.players.filter((player) => player.id !== self.id && player.team === self.team),
      opponents: [...this.lastSeen.values()], acorns, berries: snapshot.berries.filter((berry) => visiblePoint(berry.position)),
      minimapAcorns: snapshot.acorns, minimapBerries: snapshot.berries, minimapCarriers,
      storageAcornCounts, thiefSecuredCount: snapshot.thiefSecuredCount, recentThunderHit: this.recentThunderHit
    };
  }
}
