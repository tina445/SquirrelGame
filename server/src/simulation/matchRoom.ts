import {
  InputButton, SeededRandom, add, clampMagnitude, distanceSquared, envelope, findNearestValidPosition,
  fixedDeltaMs, gameBalance, generateMap, lineOfSight, moveCircle, normalize, scale, segmentIntersectsAabb,
  totalAcorns,
  type AcornId, type AcornState, type BerryId, type BerryState, type GameEvent, type InputCommand,
  type InteractionState, type MapDefinition, type MatchEndReason, type MatchPhase, type PlayerId,
  type PlayerState, type ProjectileId, type ServerMessage, type Team, type ThunderProjectileState,
  type Vec2, type WorldSnapshot
} from '@squirrel-heist/shared';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { RoomMetrics } from '../observability/metrics.js';

const idleInput: InputCommand = { sequence: -1, clientTick: 0, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 };

export interface RoomOptions {
  id: string;
  seed: string;
  allowEarlyStart?: boolean;
  countdownMs?: number;
}

export interface RoomConnection {
  id: string;
  send(message: ServerMessage): void;
}

export class MatchRoom {
  readonly id: string;
  readonly map: MapDefinition;
  readonly metrics = new RoomMetrics();
  phase: MatchPhase = 'LOBBY';
  serverTick = 0;
  nowMs = 0;
  remainingMs = gameBalance.matchDurationMs;
  winner: Team | null = null;
  endReason: MatchEndReason | null = null;
  readonly players = new Map<PlayerId, PlayerState>();
  readonly acorns = new Map<AcornId, AcornState>();
  readonly berries = new Map<BerryId, BerryState>();
  readonly projectiles = new Map<ProjectileId, ThunderProjectileState>();
  readonly interactions = new Map<PlayerId, InteractionState>();
  readonly connections = new Map<PlayerId, RoomConnection>();
  readonly inputQueues = new Map<PlayerId, InputCommand[]>();
  private readonly random: SeededRandom;
  private readonly pendingEvents: GameEvent[] = [];
  private eventSequence = 0;
  private entitySequence = 0;
  private countdownEndsAtMs: number | null = null;
  private allThievesJailedSinceMs: number | null = null;
  private nextBerrySpawnAtMs: number;
  private readonly allowEarlyStart: boolean;
  private readonly countdownMs: number;

  constructor(options: RoomOptions) {
    this.id = options.id;
    const generated = generateMap(options.seed);
    this.map = generated.map;
    this.random = new SeededRandom(`${this.map.seed}:simulation`);
    this.nextBerrySpawnAtMs = this.random.range(gameBalance.berrySpawnMinMs, gameBalance.berrySpawnMaxMs);
    this.allowEarlyStart = options.allowEarlyStart ?? false;
    this.countdownMs = options.countdownMs ?? 3_000;
    this.createAcorns();
    console.info(JSON.stringify({ level: 'info', event: 'room_created', roomId: this.id, seed: this.map.seed, mapHash: this.map.hash, generatorVersion: this.map.generatorVersion, generationAttempts: generated.attempts }));
  }

  private createAcorns(): void {
    for (const storage of this.map.storages) {
      for (let slot = 0; slot < gameBalance.acornsPerStorage; slot += 1) {
        const id = `${storage.id}-acorn-${slot}` as AcornId;
        this.acorns.set(id, { id, location: { kind: 'POLICE_STORAGE', storageId: storage.id, slot } });
      }
    }
  }

  addPlayer(connection: RoomConnection, displayName: string, preferredTeam?: Team): PlayerState {
    if (this.phase !== 'LOBBY') throw new Error('ROOM_ALREADY_STARTED');
    if (this.players.size >= gameBalance.teamSize * 2) throw new Error('ROOM_FULL');
    const team = this.selectTeam(preferredTeam);
    const teamIndex = [...this.players.values()].filter((player) => player.team === team).length;
    const id = `player-${this.players.size + 1}-${randomBytes(3).toString('hex')}` as PlayerId;
    const player: PlayerState = {
      id, connectionId: connection.id, reconnectToken: randomBytes(16).toString('hex'), displayName,
      team, position: { ...this.map.teamSpawns[team][teamIndex]! }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
      mode: 'NORMAL', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0,
      jailedAtMs: null, disconnectedAtMs: null, ready: false, lastProcessedInputSequence: -1, lastValidInput: { ...idleInput }
    };
    this.players.set(id, player);
    this.connections.set(id, connection);
    this.inputQueues.set(id, []);
    this.interactions.set(id, { kind: 'NONE' });
    return player;
  }

  private selectTeam(preferred?: Team): Team {
    const counts: Record<Team, number> = { POLICE: 0, THIEF: 0 };
    for (const player of this.players.values()) counts[player.team] += 1;
    if (preferred && counts[preferred] < gameBalance.teamSize && counts[preferred] <= counts[preferred === 'POLICE' ? 'THIEF' : 'POLICE']) return preferred;
    return counts.THIEF <= counts.POLICE ? 'THIEF' : 'POLICE';
  }

  setReady(playerId: PlayerId, mapHash: string, assetsReady: boolean): boolean {
    const player = this.players.get(playerId);
    if (!player || mapHash !== this.map.hash || !assetsReady) return false;
    player.ready = true;
    const required = this.allowEarlyStart ? Math.max(1, this.players.size) : gameBalance.teamSize * 2;
    if (this.phase === 'LOBBY' && this.players.size >= required && [...this.players.values()].every((item) => item.ready)) this.beginCountdown();
    return true;
  }

  beginCountdown(): void {
    if (this.phase !== 'LOBBY') return;
    this.phase = 'COUNTDOWN';
    this.countdownEndsAtMs = this.nowMs + this.countdownMs;
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner: null, reason: null, countdownEndsAtMs: this.countdownEndsAtMs }, this.id));
  }

  startImmediately(): void {
    if (this.phase === 'FINISHED' || this.phase === 'CLOSED') return;
    this.phase = 'PLAYING';
    this.countdownEndsAtMs = null;
  }

  enqueueInput(playerId: PlayerId, input: InputCommand): boolean {
    const player = this.players.get(playerId);
    const queue = this.inputQueues.get(playerId);
    if (!player || !queue || input.sequence <= player.lastProcessedInputSequence || queue.some((item) => item.sequence === input.sequence)) return false;
    queue.push({ ...input, moveX: clampMagnitude({ x: input.moveX, y: input.moveY }).x, moveY: clampMagnitude({ x: input.moveX, y: input.moveY }).y });
    queue.sort((a, b) => a.sequence - b.sequence);
    if (queue.length > 120) queue.splice(0, queue.length - 120);
    return true;
  }

  tick(deltaMs = fixedDeltaMs): void {
    const started = performance.now();
    this.nowMs += deltaMs;
    this.serverTick += 1;
    if (this.phase === 'COUNTDOWN' && this.countdownEndsAtMs !== null && this.nowMs >= this.countdownEndsAtMs) {
      this.phase = 'PLAYING';
      this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner: null, reason: null }, this.id));
    }
    this.expireDisconnectedPlayers();
    if (this.phase === 'PLAYING') {
      this.updateTimers();
      this.processInputsAndMovement(deltaMs);
      this.processInteractions(deltaMs);
      this.processProjectiles(deltaMs);
      this.processBerries();
      this.checkObjectives(deltaMs);
    }
    this.assertAcornInvariant();
    this.broadcastSnapshots();
    this.flushEvents();
    this.metrics.recordTick(performance.now() - started);
  }

  private updateTimers(): void {
    for (const player of this.players.values()) {
      if (player.mode === 'STUNNED' && this.nowMs >= player.stunUntilMs) {
        player.mode = 'NORMAL';
        this.event('STUN_ENDED', { playerId: player.id });
      }
    }
  }

  private processInputsAndMovement(deltaMs: number): void {
    for (const player of this.players.values()) {
      const queue = this.inputQueues.get(player.id)!;
      const newest = queue.at(-1);
      queue.length = 0;
      if (newest) {
        player.lastProcessedInputSequence = newest.sequence;
        const previousButtons = player.lastValidInput.buttons;
        player.lastValidInput = newest;
        if ((newest.buttons & InputButton.ACORN) !== 0 && (previousButtons & InputButton.ACORN) === 0) this.handleAcornAction(player);
        if ((newest.buttons & InputButton.FIRE) !== 0 && (previousButtons & InputButton.FIRE) === 0) this.fireThunder(player);
      }
      const input = player.lastValidInput;
      const direction = clampMagnitude({ x: input.moveX, y: input.moveY });
      const aim = normalize({ x: input.aimX, y: input.aimY });
      if (aim.x !== 0 || aim.y !== 0) player.facing = aim;
      if (player.mode !== 'NORMAL') {
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const carryMultiplier = player.heldAcornId ? gameBalance.carrySpeedMultiplier : 1;
      player.velocity = scale(direction, gameBalance.playerSpeed * carryMultiplier);
      player.position = moveCircle(player.position, scale(player.velocity, deltaMs / 1_000), gameBalance.playerRadius, this.map.bounds, this.map.staticColliders);
    }
  }

  private handleAcornAction(player: PlayerState): void {
    if (player.mode !== 'NORMAL') return;
    if (player.heldAcornId) {
      if (player.team === 'THIEF' && this.inZone(player.position, this.map.thiefBase)) {
        const acorn = this.acorns.get(player.heldAcornId)!;
        const slot = [...this.acorns.values()].filter((item) => item.location.kind === 'SECURED').length;
        acorn.location = { kind: 'SECURED', slot };
        player.heldAcornId = null;
        this.event('ACORN_SECURED', { playerId: player.id, acornId: acorn.id, slot });
        return;
      }
      if (player.team === 'POLICE') {
        const storage = this.map.storages.find((item) => this.inZone(player.position, item) && this.storageCount(item.id) < gameBalance.acornsPerStorage);
        if (storage) {
          const acorn = this.acorns.get(player.heldAcornId)!;
          const used = new Set([...this.acorns.values()].flatMap((item) => item.location.kind === 'POLICE_STORAGE' && item.location.storageId === storage.id ? [item.location.slot] : []));
          const slot = [0, 1, 2].find((value) => !used.has(value))!;
          acorn.location = { kind: 'POLICE_STORAGE', storageId: storage.id, slot };
          player.heldAcornId = null;
          this.event('ACORN_RETURNED', { playerId: player.id, acornId: acorn.id, storageId: storage.id });
          return;
        }
      }
      this.dropHeldAcorn(player, player.position);
      return;
    }
    const allowed = [...this.acorns.values()].filter((acorn) => {
      if (acorn.location.kind === 'GROUND') return distanceSquared(player.position, acorn.location.position) <= gameBalance.interactionRadius ** 2;
      if (player.team === 'THIEF' && acorn.location.kind === 'POLICE_STORAGE') {
        const storage = this.map.storages.find((item) => item.id === acorn.location.storageId)!;
        return this.inZone(player.position, storage);
      }
      return false;
    });
    const acorn = allowed[0];
    if (!acorn) return;
    acorn.location = { kind: 'CARRIED', carrierId: player.id };
    player.heldAcornId = acorn.id;
    this.event('ACORN_PICKED_UP', { playerId: player.id, acornId: acorn.id });
  }

  private dropHeldAcorn(player: PlayerState, origin: Vec2): void {
    if (!player.heldAcornId) return;
    const position = findNearestValidPosition(origin, 0.25, this.map.bounds, this.map.staticColliders);
    if (!position) return;
    const acorn = this.acorns.get(player.heldAcornId)!;
    acorn.location = { kind: 'GROUND', position };
    player.heldAcornId = null;
    this.event('ACORN_DROPPED', { playerId: player.id, acornId: acorn.id, position });
  }

  private processInteractions(deltaMs: number): void {
    for (const actor of this.players.values()) {
      const holding = (actor.lastValidInput.buttons & InputButton.INTERACT) !== 0;
      if (!holding || actor.mode !== 'NORMAL') {
        this.cancelInteraction(actor.id, holding ? 'ACTOR_DISABLED' : 'RELEASED');
        continue;
      }
      if (actor.team === 'POLICE') this.advanceArrest(actor, deltaMs);
      else this.advanceRescue(actor, deltaMs);
    }
  }

  private advanceArrest(actor: PlayerState, deltaMs: number): void {
    const current = this.interactions.get(actor.id)!;
    const currentTarget = current.kind === 'ARREST' ? this.players.get(current.targetId) : undefined;
    const target = currentTarget && this.canArrest(actor, currentTarget) ? currentTarget : [...this.players.values()]
      .filter((candidate) => this.canArrest(actor, candidate))
      .sort((a, b) => distanceSquared(actor.position, a.position) - distanceSquared(actor.position, b.position))[0];
    if (!target) { this.cancelInteraction(actor.id, 'NO_TARGET'); return; }
    const next: InteractionState = current.kind === 'ARREST' && current.targetId === target.id
      ? { ...current, progressMs: current.progressMs + deltaMs }
      : { kind: 'ARREST', actorId: actor.id, targetId: target.id, startedAtTick: this.serverTick, progressMs: deltaMs };
    this.interactions.set(actor.id, next);
    if (next.progressMs >= gameBalance.arrestHoldMs) this.completeArrest(actor, target);
  }

  private canArrest(actor: PlayerState, target: PlayerState): boolean {
    return actor.team === 'POLICE' && target.team === 'THIEF' && target.mode !== 'JAILED' && target.arrestImmuneUntilMs <= this.nowMs &&
      distanceSquared(actor.position, target.position) <= gameBalance.interactionRadius ** 2 && lineOfSight(actor.position, target.position, this.map.staticColliders);
  }

  private completeArrest(actor: PlayerState, target: PlayerState): void {
    this.dropHeldAcorn(target, target.position);
    const jailedCount = [...this.players.values()].filter((player) => player.team === 'THIEF' && player.mode === 'JAILED').length;
    target.position = { ...this.map.jail.slots[Math.min(jailedCount, this.map.jail.slots.length - 1)]! };
    target.velocity = { x: 0, y: 0 };
    target.mode = 'JAILED';
    target.jailedAtMs = this.nowMs;
    this.interactions.set(actor.id, { kind: 'NONE' });
    this.cancelInteractionsTargeting(target.id, 'TARGET_JAILED');
    this.event('ARREST_COMPLETED', { actorId: actor.id, targetId: target.id });
  }

  private advanceRescue(actor: PlayerState, deltaMs: number): void {
    if (!this.inZone(actor.position, this.map.jail)) { this.cancelInteraction(actor.id, 'OUT_OF_RANGE'); return; }
    const jailed = [...this.players.values()].filter((player) => player.team === 'THIEF' && player.mode === 'JAILED').sort((a, b) => (a.jailedAtMs ?? 0) - (b.jailedAtMs ?? 0));
    const target = jailed[0];
    if (!target) { this.cancelInteraction(actor.id, 'NO_TARGET'); return; }
    const current = this.interactions.get(actor.id)!;
    const next: InteractionState = current.kind === 'RESCUE' && current.targetId === target.id
      ? { ...current, progressMs: current.progressMs + deltaMs }
      : { kind: 'RESCUE', actorId: actor.id, targetId: target.id, startedAtTick: this.serverTick, progressMs: deltaMs };
    this.interactions.set(actor.id, next);
    if (next.progressMs >= gameBalance.rescueHoldMs) this.completeRescue(actor, target);
  }

  private completeRescue(actor: PlayerState, target: PlayerState): void {
    const point = this.map.jail.escapePoints.find((candidate) => [...this.players.values()].every((player) => player.id === target.id || distanceSquared(player.position, candidate) > (gameBalance.playerRadius * 2) ** 2)) ?? this.map.jail.escapePoints[0]!;
    target.position = { ...point };
    target.mode = 'NORMAL';
    target.jailedAtMs = null;
    target.arrestImmuneUntilMs = this.nowMs + gameBalance.rescueArrestImmunityMs;
    this.interactions.set(actor.id, { kind: 'NONE' });
    this.event('RESCUE_COMPLETED', { actorId: actor.id, targetId: target.id, position: point });
  }

  private cancelInteraction(playerId: PlayerId, reason: string): void {
    const current = this.interactions.get(playerId);
    if (current && current.kind !== 'NONE') {
      this.interactions.set(playerId, { kind: 'NONE' });
      this.event('INTERACTION_CANCELLED', { playerId, kind: current.kind, reason });
    }
  }

  private cancelInteractionsTargeting(playerId: PlayerId, reason: string): void {
    for (const [actorId, interaction] of this.interactions) if (interaction.kind !== 'NONE' && interaction.targetId === playerId) this.cancelInteraction(actorId, reason);
  }

  private fireThunder(player: PlayerState): void {
    if (!player.hasThunder || player.mode !== 'NORMAL') return;
    player.hasThunder = false;
    const id = `projectile-${++this.entitySequence}` as ProjectileId;
    this.projectiles.set(id, { id, ownerId: player.id, team: player.team, position: add(player.position, scale(player.facing, gameBalance.playerRadius + 0.2)), direction: player.facing, remainingRange: gameBalance.projectileRange, spawnedAtTick: this.serverTick });
    this.event('THUNDER_FIRED', { playerId: player.id, projectileId: id });
  }

  private processProjectiles(deltaMs: number): void {
    for (const projectile of [...this.projectiles.values()]) {
      const distance = Math.min(projectile.remainingRange, gameBalance.projectileSpeed * deltaMs / 1_000);
      const end = add(projectile.position, scale(projectile.direction, distance));
      if (this.map.staticColliders.some((box) => segmentIntersectsAabb(projectile.position, end, box))) {
        this.projectiles.delete(projectile.id);
        this.event('THUNDER_HIT_WALL', { projectileId: projectile.id });
        continue;
      }
      const hit = [...this.players.values()].find((player) => player.team !== projectile.team && player.mode !== 'JAILED' && pointSegmentDistanceSquared(player.position, projectile.position, end) <= (gameBalance.playerRadius + gameBalance.projectileRadius) ** 2);
      if (hit) {
        hit.mode = 'STUNNED';
        hit.stunUntilMs = Math.max(hit.stunUntilMs, this.nowMs + gameBalance.thunderStunMs);
        hit.velocity = { x: 0, y: 0 };
        this.cancelInteraction(hit.id, 'STUNNED');
        this.cancelInteractionsTargeting(hit.id, 'TARGET_STUNNED');
        this.projectiles.delete(projectile.id);
        this.event('THUNDER_HIT', { projectileId: projectile.id, targetId: hit.id });
        continue;
      }
      projectile.position = end;
      projectile.remainingRange -= distance;
      if (projectile.remainingRange <= 0) this.projectiles.delete(projectile.id);
    }
  }

  private processBerries(): void {
    if (this.nowMs >= this.nextBerrySpawnAtMs && this.berries.size < gameBalance.maxActiveBerries) {
      const available = this.map.berrySpawnPoints.filter((point) => [...this.berries.values()].every((berry) => distanceSquared(point, berry.position) > 1));
      const position = available[this.random.integer(0, available.length)];
      if (position) {
        const id = `berry-${++this.entitySequence}` as BerryId;
        this.berries.set(id, { id, position: { ...position }, spawnedAtTick: this.serverTick });
        this.event('BERRY_SPAWNED', { berryId: id, position });
      }
      this.nextBerrySpawnAtMs = this.nowMs + this.random.range(gameBalance.berrySpawnMinMs, gameBalance.berrySpawnMaxMs);
    }
    for (const player of this.players.values()) {
      if (player.hasThunder || player.mode !== 'NORMAL') continue;
      const berry = [...this.berries.values()].find((item) => distanceSquared(player.position, item.position) <= gameBalance.berryPickupRadius ** 2);
      if (!berry) continue;
      player.hasThunder = true;
      this.berries.delete(berry.id);
      this.event('BERRY_PICKED_UP', { playerId: player.id, berryId: berry.id });
    }
  }

  private checkObjectives(deltaMs: number): void {
    const secured = [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'SECURED').length;
    if (secured === totalAcorns) { this.finish('THIEF', 'THIEF_SECURED_ALL'); return; }
    const thieves = [...this.players.values()].filter((player) => player.team === 'THIEF');
    const allJailed = thieves.length === gameBalance.teamSize && thieves.every((player) => player.mode === 'JAILED');
    if (allJailed) this.allThievesJailedSinceMs ??= this.nowMs;
    else this.allThievesJailedSinceMs = null;
    if (this.allThievesJailedSinceMs !== null && this.nowMs - this.allThievesJailedSinceMs >= gameBalance.allJailedConfirmMs) { this.finish('POLICE', 'ALL_THIEVES_JAILED'); return; }
    this.remainingMs = Math.max(0, this.remainingMs - deltaMs);
    if (this.remainingMs <= 0) this.finish('POLICE', 'TIME_EXPIRED');
  }

  private finish(winner: Team, reason: MatchEndReason): void {
    this.phase = 'FINISHED';
    this.winner = winner;
    this.endReason = reason;
    for (const player of this.players.values()) player.velocity = { x: 0, y: 0 };
    for (const playerId of this.interactions.keys()) this.interactions.set(playerId, { kind: 'NONE' });
    this.event('MATCH_FINISHED', { winner, reason });
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner, reason }, this.id));
  }

  disconnect(playerId: PlayerId): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connectionId = null;
    player.disconnectedAtMs = this.nowMs;
    player.lastValidInput = { ...idleInput };
    this.connections.delete(playerId);
  }

  reconnect(token: string, connection: RoomConnection): PlayerState | null {
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token && candidate.disconnectedAtMs !== null && this.nowMs - candidate.disconnectedAtMs <= gameBalance.reconnectGraceMs);
    if (!player) return null;
    player.connectionId = connection.id;
    player.disconnectedAtMs = null;
    this.connections.set(player.id, connection);
    return player;
  }

  private expireDisconnectedPlayers(): void {
    for (const player of this.players.values()) {
      if (player.disconnectedAtMs !== null && this.nowMs - player.disconnectedAtMs > gameBalance.reconnectGraceMs) {
        this.dropHeldAcorn(player, player.position);
        player.disconnectedAtMs = null;
      }
    }
  }

  snapshotFor(playerId: PlayerId): WorldSnapshot {
    const local = this.players.get(playerId);
    return {
      serverTick: this.serverTick, serverTimeMs: this.nowMs, ackInputSequence: local?.lastProcessedInputSequence ?? -1,
      phase: this.phase, remainingMs: this.remainingMs,
      players: [...this.players.values()].map(({ reconnectToken: _token, lastValidInput: _input, ...player }) => ({ ...player })),
      acorns: [...this.acorns.values()], berries: [...this.berries.values()], projectiles: [...this.projectiles.values()],
      interactions: [...this.interactions].map(([id, state]) => ({ playerId: id, state })),
      thiefSecuredCount: [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'SECURED').length
    };
  }

  fullStateFor(playerId: PlayerId): ServerMessage {
    return envelope('S2C_FULL_STATE', { map: this.map, snapshot: this.snapshotFor(playerId) }, this.id);
  }

  private broadcastSnapshots(): void {
    for (const [playerId, connection] of this.connections) connection.send(envelope('S2C_WORLD_SNAPSHOT', this.snapshotFor(playerId), this.id));
  }

  private broadcast(message: ServerMessage): void { for (const connection of this.connections.values()) connection.send(message); }
  private event(type: string, payload: Record<string, unknown>): void { this.pendingEvents.push({ eventId: `${this.id}:${++this.eventSequence}`, type, tick: this.serverTick, payload }); }
  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    this.broadcast(envelope('S2C_GAME_EVENTS', { events: this.pendingEvents.splice(0) }, this.id));
  }
  private inZone(position: Vec2, zone: { center: Vec2; radius: number }): boolean { return distanceSquared(position, zone.center) <= zone.radius ** 2; }
  private storageCount(storageId: string): number { return [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storageId).length; }

  assertAcornInvariant(): void {
    if (this.acorns.size !== totalAcorns) throw new Error(`Acorn conservation failed: ${this.acorns.size}`);
    const carried = new Map<PlayerId, AcornId>();
    for (const acorn of this.acorns.values()) {
      if (acorn.location.kind !== 'CARRIED') continue;
      if (carried.has(acorn.location.carrierId)) throw new Error('Player carries multiple acorns');
      carried.set(acorn.location.carrierId, acorn.id);
    }
    for (const player of this.players.values()) {
      if ((carried.get(player.id) ?? null) !== player.heldAcornId) throw new Error('Acorn carrier relation mismatch');
    }
  }
}

function pointSegmentDistanceSquared(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return distanceSquared(point, start);
  const alpha = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return distanceSquared(point, { x: start.x + dx * alpha, y: start.y + dy * alpha });
}
