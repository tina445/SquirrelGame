import {
  InputButton, SeededRandom, add, clampMagnitude, distanceSquared, envelope, findNearestValidPosition, isCircleInPolygon,
  fixedDeltaMs, gameBalance, generateMap, lineOfSight, moveCircle, normalize, scale,
  segmentAabbHitFraction, totalAcorns,
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
  listed?: boolean;
  teamSeed?: string;
  allowEarlyStart?: boolean;
  countdownMs?: number;
}

export interface RoomConnection {
  id: string;
  send(message: ServerMessage): void;
  close?(code: number, reason: string): void;
}

export class MatchRoom {
  readonly id: string;
  readonly listed: boolean;
  readonly map: MapDefinition;
  readonly metrics = new RoomMetrics();
  phase: MatchPhase = 'LOBBY';
  serverTick = 0;
  nowMs = 0;
  remainingMs: number = gameBalance.matchDurationMs;
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
  private readonly teamRandom: SeededRandom;
  private readonly pendingEvents: GameEvent[] = [];
  private eventSequence = 0;
  private entitySequence = 0;
  private countdownEndsAtMs: number | null = null;
  private allThievesJailedSinceMs: number | null = null;
  private nextBerrySpawnAtMs: number;
  private readonly allowEarlyStart: boolean;
  private readonly countdownMs: number;

  /** seed 기반 권위 맵과 시뮬레이션 난수열을 만들고 도토리 보존 불변조건의 초기 상태를 구성한다. */
  constructor(options: RoomOptions) {
    this.id = options.id;
    this.listed = options.listed ?? true;
    const generated = generateMap(options.seed);
    this.map = generated.map;
    this.random = new SeededRandom(`${this.map.seed}:simulation`);
    this.teamRandom = new SeededRandom(options.teamSeed ?? randomBytes(16).toString('hex'));
    this.nextBerrySpawnAtMs = this.random.range(gameBalance.berrySpawnMinMs, gameBalance.berrySpawnMaxMs);
    this.allowEarlyStart = options.allowEarlyStart ?? false;
    this.countdownMs = options.countdownMs ?? 3_000;
    this.createAcorns();
    console.info(JSON.stringify({ level: 'info', event: 'room_created', roomId: this.id, seed: this.map.seed, mapHash: this.map.hash, generatorVersion: this.map.generatorVersion, generationAttempts: generated.attempts }));
  }

  /** 각 저장소 슬롯에 정확히 하나씩 도토리를 만들어 총 9개 불변조건을 시작한다. */
  private createAcorns(): void {
    for (const storage of this.map.storages) {
      for (let slot = 0; slot < gameBalance.acornsPerStorage; slot += 1) {
        const id = `${storage.id}-acorn-${slot}` as AcornId;
        this.acorns.set(id, { id, location: { kind: 'POLICE_STORAGE', storageId: storage.id, slot } });
      }
    }
  }

  /** 로비 정원과 팀 균형을 검증한 뒤 플레이어의 모든 권위 상태와 연결 adapter를 등록한다. */
  addPlayer(connection: RoomConnection, displayName: string, forcedTeam?: Team): PlayerState {
    if (this.phase !== 'LOBBY') throw new Error('ROOM_ALREADY_STARTED');
    if (this.players.size >= gameBalance.teamSize * 2) throw new Error('ROOM_FULL');
    const team = this.selectTeam(forcedTeam);
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

  /** 테스트용 강제값 외에는 적은 팀을 우선하고 동률일 때 Room seed 난수로 역할군을 배정한다. */
  private selectTeam(forced?: Team): Team {
    const counts: Record<Team, number> = { POLICE: 0, THIEF: 0 };
    for (const player of this.players.values()) counts[player.team] += 1;
    if (forced && counts[forced] < gameBalance.teamSize) return forced;
    if (counts.THIEF < counts.POLICE) return 'THIEF';
    if (counts.POLICE < counts.THIEF) return 'POLICE';
    return this.teamRandom.next() < 0.5 ? 'THIEF' : 'POLICE';
  }

  /** 클라이언트의 맵 해시·asset 준비를 확인하고 필요한 전원이 준비되면 countdown을 연다. */
  setReady(playerId: PlayerId, mapHash: string, assetsReady: boolean): boolean {
    const player = this.players.get(playerId);
    if (!player || mapHash !== this.map.hash || !assetsReady) return false;
    player.ready = true;
    const required = this.allowEarlyStart ? Math.max(1, this.players.size) : gameBalance.teamSize * 2;
    if (this.phase === 'LOBBY' && this.players.size >= required && [...this.players.values()].every((item) => item.ready)) this.beginCountdown();
    return true;
  }

  /** LOBBY에서 COUNTDOWN으로 한 번만 전이하고 종료 시각을 모든 연결에 알린다. */
  beginCountdown(): void {
    if (this.phase !== 'LOBBY') return;
    this.phase = 'COUNTDOWN';
    this.countdownEndsAtMs = this.nowMs + this.countdownMs;
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner: null, reason: null, countdownEndsAtMs: this.countdownEndsAtMs }, this.id));
  }

  /** 테스트·시연 모드에서 종료 상태를 제외한 Room을 즉시 PLAYING으로 전환한다. */
  startImmediately(): void {
    if (this.phase === 'FINISHED' || this.phase === 'CLOSED') return;
    this.phase = 'PLAYING';
    this.countdownEndsAtMs = null;
  }

  /** 오래되거나 중복된 sequence를 거부하고 이동 크기를 제한한 입력만 정렬 큐에 보관한다. */
  enqueueInput(playerId: PlayerId, input: InputCommand): boolean {
    const player = this.players.get(playerId);
    const queue = this.inputQueues.get(playerId);
    if (!player || !queue || input.sequence <= player.lastProcessedInputSequence || queue.some((item) => item.sequence === input.sequence)) return false;
    queue.push({ ...input, moveX: clampMagnitude({ x: input.moveX, y: input.moveY }).x, moveY: clampMagnitude({ x: input.moveX, y: input.moveY }).y });
    queue.sort((a, b) => a.sequence - b.sequence);
    if (queue.length > 120) queue.splice(0, queue.length - 120);
    return true;
  }

  /** 한 fixed step의 시스템 순서를 고정하고 마지막에 불변조건·snapshot·event·성능을 확정한다. */
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

  /** 서버 시각에 도달한 STUN 상태를 해제하고 단발 event를 기록한다. */
  private updateTimers(): void {
    for (const player of this.players.values()) {
      if (player.mode === 'STUNNED' && this.nowMs >= player.stunUntilMs) {
        player.mode = 'NORMAL';
        this.event('STUN_ENDED', { playerId: player.id });
      }
    }
  }

  /** 입력을 sequence 순서로 소비해 모든 edge를 보존하고 마지막 이동 의도를 권위 위치에 적용한다. */
  private processInputsAndMovement(deltaMs: number): void {
    for (const player of this.players.values()) {
      const queue = this.inputQueues.get(player.id)!;
      const inputs = queue.splice(0);
      for (const next of inputs) {
        player.lastProcessedInputSequence = next.sequence;
        const previousButtons = player.lastValidInput.buttons;
        const nextAim = normalize({ x: next.aimX, y: next.aimY });
        if (nextAim.x !== 0 || nextAim.y !== 0) player.facing = nextAim;
        player.lastValidInput = next;
        if ((next.buttons & InputButton.ACORN) !== 0 && (previousButtons & InputButton.ACORN) === 0) this.handleAcornAction(player);
        if ((next.buttons & InputButton.FIRE) !== 0 && (previousButtons & InputButton.FIRE) === 0) this.fireThunder(player);
      }
      const input = player.lastValidInput;
      const direction = clampMagnitude({ x: input.moveX, y: input.moveY });
      if (player.mode !== 'NORMAL') {
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const carryMultiplier = player.heldAcornId ? gameBalance.carrySpeedMultiplier : 1;
      player.velocity = scale(direction, gameBalance.playerSpeed * carryMultiplier);
      player.position = moveCircle(player.position, scale(player.velocity, deltaMs / 1_000), gameBalance.playerRadius, this.map.bounds, this.map.staticColliders, this.map.playableArea);
    }
  }

  /** 팀·보유 상태·영역에 따라 하나의 서버 권위 도토리 상태 전이만 수행한다. */
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
    const allowed = [...this.acorns.values()].flatMap((acorn) => {
      if (acorn.location.kind === 'GROUND') return distanceSquared(player.position, acorn.location.position) <= gameBalance.interactionRadius ** 2 ? [{ acorn, distance: distanceSquared(player.position, acorn.location.position) }] : [];
      if (player.team === 'THIEF' && acorn.location.kind === 'POLICE_STORAGE') {
        const storageId = acorn.location.storageId;
        const storage = this.map.storages.find((item) => item.id === storageId)!;
        return this.inZone(player.position, storage) ? [{ acorn, distance: distanceSquared(player.position, storage.center) }] : [];
      }
      return [];
    }).sort((a, b) => a.distance - b.distance);
    const acorn = allowed[0]?.acorn;
    if (!acorn) return;
    acorn.location = { kind: 'CARRIED', carrierId: player.id };
    player.heldAcornId = acorn.id;
    this.event('ACORN_PICKED_UP', { playerId: player.id, acornId: acorn.id });
  }

  /** 운반 도토리를 가장 가까운 유효 필드 좌표로 옮기고 양방향 보유 관계를 해제한다. */
  private dropHeldAcorn(player: PlayerState, origin: Vec2): void {
    if (!player.heldAcornId) return;
    const position = findNearestValidPosition(origin, 0.25, this.map.bounds, this.map.staticColliders, this.map.playableArea);
    if (!position) return;
    const acorn = this.acorns.get(player.heldAcornId)!;
    acorn.location = { kind: 'GROUND', position };
    player.heldAcornId = null;
    this.event('ACORN_DROPPED', { playerId: player.id, acornId: acorn.id, position });
  }

  /** E hold가 유효한 동안 팀별 체포/구출을 진행하고 해제·비활성화 시 즉시 취소한다. */
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

  /** 기존 유효 대상을 유지하거나 가장 가까운 새 대상을 선택해 체포 진행시간을 누적한다. */
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

  /** 팀·수감·면역·거리·시야 조건을 모두 만족하는 서버 권위 체포 대상인지 판정한다. */
  private canArrest(actor: PlayerState, target: PlayerState): boolean {
    return actor.team === 'POLICE' && target.team === 'THIEF' && target.mode !== 'JAILED' && target.arrestImmuneUntilMs <= this.nowMs &&
      distanceSquared(actor.position, target.position) <= gameBalance.interactionRadius ** 2 && lineOfSight(actor.position, target.position, this.map.staticColliders);
  }

  /** 도토리를 먼저 안전하게 떨어뜨린 뒤 감옥 슬롯 이동과 관련 상호작용 취소를 원자적으로 적용한다. */
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

  /** 감옥 영역에서 가장 오래 수감된 도둑 한 명만 선택해 구출 진행시간을 누적한다. */
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

  /** 비어 있는 탈출 후보를 우선 선택하고 이동·상태 복구·체포 면역을 함께 확정한다. */
  private completeRescue(actor: PlayerState, target: PlayerState): void {
    const point = this.map.jail.escapePoints.find((candidate) => [...this.players.values()].every((player) => player.id === target.id || distanceSquared(player.position, candidate) > (gameBalance.playerRadius * 2) ** 2)) ?? this.map.jail.escapePoints[0]!;
    target.position = { ...point };
    target.mode = 'NORMAL';
    target.jailedAtMs = null;
    target.arrestImmuneUntilMs = this.nowMs + gameBalance.rescueArrestImmunityMs;
    this.interactions.set(actor.id, { kind: 'NONE' });
    this.event('RESCUE_COMPLETED', { actorId: actor.id, targetId: target.id, position: point });
  }

  /** 진행 중인 상호작용을 NONE으로 되돌리고 취소 이유를 event로 남긴다. */
  private cancelInteraction(playerId: PlayerId, reason: string): void {
    const current = this.interactions.get(playerId);
    if (current && current.kind !== 'NONE') {
      this.interactions.set(playerId, { kind: 'NONE' });
      this.event('INTERACTION_CANCELLED', { playerId, kind: current.kind, reason });
    }
  }

  /** 상태가 바뀐 대상을 바라보던 모든 다른 플레이어의 상호작용을 취소한다. */
  private cancelInteractionsTargeting(playerId: PlayerId, reason: string): void {
    for (const [actorId, interaction] of this.interactions) if (interaction.kind !== 'NONE' && interaction.targetId === playerId) this.cancelInteraction(actorId, reason);
  }

  /** 보유 자원을 한 번 소비하고 현재 서버 facing을 복제한 단발 투사체를 생성한다. */
  private fireThunder(player: PlayerState): void {
    if (!player.hasThunder || player.mode !== 'NORMAL') return;
    player.hasThunder = false;
    const id = `projectile-${++this.entitySequence}` as ProjectileId;
    this.projectiles.set(id, { id, ownerId: player.id, team: player.team, position: add(player.position, scale(player.facing, gameBalance.playerRadius + 0.2)), direction: player.facing, remainingRange: gameBalance.projectileRange, spawnedAtTick: this.serverTick });
    this.event('THUNDER_FIRED', { playerId: player.id, projectileId: id });
  }

  /** swept segment로 벽과 상대의 최초 충돌을 비교하고 명중·기절·제거를 서버에서 확정한다. */
  private processProjectiles(deltaMs: number): void {
    for (const projectile of [...this.projectiles.values()]) {
      const distance = Math.min(projectile.remainingRange, gameBalance.projectileSpeed * deltaMs / 1_000);
      const end = add(projectile.position, scale(projectile.direction, distance));
      const obstacleWallFraction = this.map.staticColliders.reduce<number | null>((closest, box) => {
        const hit = segmentAabbHitFraction(projectile.position, end, box);
        return hit === null || (closest !== null && closest <= hit) ? closest : hit;
      }, null);
      const boundaryWallFraction = isCircleInPolygon(end, gameBalance.projectileRadius, this.map.playableArea) ? null : 1;
      const wallFraction = obstacleWallFraction === null ? boundaryWallFraction : boundaryWallFraction === null ? obstacleWallFraction : Math.min(obstacleWallFraction, boundaryWallFraction);
      const playerHit = [...this.players.values()]
        .filter((player) => player.team !== projectile.team && player.mode !== 'JAILED')
        .map((player) => ({ player, fraction: segmentCircleHitFraction(projectile.position, end, player.position, gameBalance.playerRadius + gameBalance.projectileRadius) }))
        .filter((candidate): candidate is { player: PlayerState; fraction: number } => candidate.fraction !== null)
        .sort((a, b) => a.fraction - b.fraction)[0];
      if (wallFraction !== null && (!playerHit || wallFraction <= playerHit.fraction)) {
        this.projectiles.delete(projectile.id);
        this.event('THUNDER_HIT_WALL', { projectileId: projectile.id });
        continue;
      }
      const hit = playerHit?.player;
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

  /** seed 난수 일정으로 베리를 생성하고 접촉한 정상 플레이어에게 최대 하나의 썬더를 부여한다. */
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

  /** 도둑 즉시승을 먼저 검사한 뒤 전원 수감 확인시간과 제한시간 경찰승을 순서대로 판정한다. */
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

  /** 승패를 한 번 확정하고 모든 이동·상호작용을 정지한 뒤 phase와 event를 방송한다. */
  private finish(winner: Team, reason: MatchEndReason): void {
    this.phase = 'FINISHED';
    this.winner = winner;
    this.endReason = reason;
    for (const player of this.players.values()) player.velocity = { x: 0, y: 0 };
    for (const playerId of this.interactions.keys()) this.interactions.set(playerId, { kind: 'NONE' });
    this.event('MATCH_FINISHED', { winner, reason });
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner, reason }, this.id));
  }

  /** 연결만 분리하고 플레이어 권위 상태는 grace period 동안 보존하되 입력은 즉시 중립화한다. */
  disconnect(playerId: PlayerId, connectionId?: string): void {
    const player = this.players.get(playerId);
    if (!player || (connectionId !== undefined && player.connectionId !== connectionId)) return;
    player.connectionId = null;
    player.disconnectedAtMs = this.nowMs;
    player.lastValidInput = { ...idleInput };
    this.connections.delete(playerId);
  }

  /** 복구 불가능한 tick 오류에서 이 Room만 CLOSED로 만들고 참가자에게 알린 뒤 1011로 종료한다. */
  closeWithError(): void {
    if (this.phase === 'CLOSED') return;
    this.phase = 'CLOSED';
    for (const player of this.players.values()) {
      player.velocity = { x: 0, y: 0 };
      player.lastValidInput = { ...idleInput };
    }
    for (const playerId of this.interactions.keys()) this.interactions.set(playerId, { kind: 'NONE' });
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: 'CLOSED', winner: null, reason: null }, this.id));
    this.broadcast(envelope('S2C_ERROR', { code: 'ROOM_SIMULATION_FAILED' }, this.id));
    for (const connection of this.connections.values()) connection.close?.(1011, 'Room simulation failed');
  }

  /** 일치 token의 기존 transport를 원자적으로 교체하고 grace period 안의 권위 상태를 유지한다. */
  reconnect(token: string, connection: RoomConnection): PlayerState | null {
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token &&
      (candidate.connectionId !== null || (candidate.disconnectedAtMs !== null && this.nowMs - candidate.disconnectedAtMs <= gameBalance.reconnectGraceMs)));
    if (!player) return null;
    const previous = this.connections.get(player.id);
    player.connectionId = connection.id;
    player.disconnectedAtMs = null;
    this.connections.set(player.id, connection);
    if (previous && previous.id !== connection.id) previous.close?.(4000, 'Connection replaced');
    return player;
  }

  /** grace 만료자의 도토리를 반환하고 모든 연결이 만료된 빈 Room은 정리 가능한 CLOSED로 전환한다. */
  private expireDisconnectedPlayers(): void {
    for (const player of [...this.players.values()]) {
      if (player.disconnectedAtMs !== null && this.nowMs - player.disconnectedAtMs > gameBalance.reconnectGraceMs) {
        this.dropHeldAcorn(player, player.position);
        if (this.phase === 'LOBBY') {
          this.players.delete(player.id);
          this.inputQueues.delete(player.id);
          this.interactions.delete(player.id);
        } else player.disconnectedAtMs = null;
      }
    }
    const allConnectionsExpired = this.connections.size === 0 && (this.players.size === 0 ||
      [...this.players.values()].every((player) => player.connectionId === null && player.disconnectedAtMs === null));
    if (allConnectionsExpired) this.closeAbandoned();
  }

  /** 모든 재접속 기회가 만료된 빈 Room을 오류 없이 CLOSED로 전환해 manager가 회수할 수 있게 한다. */
  private closeAbandoned(): void {
    if (this.phase === 'CLOSED') return;
    this.phase = 'CLOSED';
    for (const player of this.players.values()) {
      player.velocity = { x: 0, y: 0 };
      player.lastValidInput = { ...idleInput };
    }
    for (const playerId of this.interactions.keys()) this.interactions.set(playerId, { kind: 'NONE' });
    console.info(JSON.stringify({ level: 'info', event: 'room_abandoned', roomId: this.id, serverTick: this.serverTick }));
  }

  /** reconnect token과 입력 원문을 제외한 전체 권위 상태에 해당 클라이언트의 ack를 붙인다. */
  snapshotFor(playerId: PlayerId): WorldSnapshot {
    const local = this.players.get(playerId);
    return {
      serverTick: this.serverTick, serverTimeMs: this.nowMs, ackInputSequence: local?.lastProcessedInputSequence ?? -1,
      phase: this.phase, remainingMs: this.remainingMs,
      players: [...this.players.values()].map(({ connectionId: _connection, reconnectToken: _token, lastValidInput: _input, ...player }) => ({ ...player })),
      acorns: [...this.acorns.values()], berries: [...this.berries.values()], projectiles: [...this.projectiles.values()],
      interactions: [...this.interactions].map(([id, state]) => ({ playerId: id, state })),
      thiefSecuredCount: [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'SECURED').length
    };
  }

  /** 재접속·resync에 필요한 맵과 현재 snapshot을 하나의 전체 상태 메시지로 만든다. */
  fullStateFor(playerId: PlayerId): ServerMessage {
    return envelope('S2C_FULL_STATE', { map: this.map, snapshot: this.snapshotFor(playerId) }, this.id);
  }

  /** 연결별 ack가 다르므로 각 플레이어 전용 snapshot을 생성해 전송한다. */
  private broadcastSnapshots(): void {
    for (const [playerId, connection] of this.connections) connection.send(envelope('S2C_WORLD_SNAPSHOT', this.snapshotFor(playerId), this.id));
  }

  /** Room의 모든 활성 연결에 동일한 서버 메시지를 보낸다. */
  private broadcast(message: ServerMessage): void { for (const connection of this.connections.values()) connection.send(message); }
  /** Room 내 단조 증가 ID와 tick을 붙여 중복 제거 가능한 도메인 event를 적재한다. */
  private event(type: string, payload: Record<string, unknown>): void { this.pendingEvents.push({ eventId: `${this.id}:${++this.eventSequence}`, type, tick: this.serverTick, payload }); }
  /** 현재 tick의 event들을 하나의 batch로 방송하고 pending queue를 비운다. */
  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    this.broadcast(envelope('S2C_GAME_EVENTS', { events: this.pendingEvents.splice(0) }, this.id));
  }
  /** 원형 zone의 경계를 포함하는 거리 판정을 공유한다. */
  private inZone(position: Vec2, zone: { center: Vec2; radius: number }): boolean { return distanceSquared(position, zone.center) <= zone.radius ** 2; }
  /** 특정 경찰 저장소에 귀속된 도토리 수를 권위 상태에서 계산한다. */
  private storageCount(storageId: string): number { return [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storageId).length; }

  /** 총 9개 보존, 1인 1개 운반, player↔acorn 양방향 관계가 깨지면 즉시 Room tick을 실패시킨다. */
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

/** 투사체 선분과 원형 플레이어의 첫 교차점을 0..1 비율로 반환한다. */
function segmentCircleHitFraction(start: Vec2, end: Vec2, center: Vec2, radius: number): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (a === 0 || discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= 1) return first;
  if (second >= 0 && second <= 1) return second;
  return null;
}
