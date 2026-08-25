import {
  InputButton, SeededRandom, add, circleIntersectsAabb, circleIntersectsCircle, clampMagnitude, distanceSquared, envelope, findNearestValidPosition, isCircleInPlayableArea,
  fixedDeltaMs, gameBalance, generateMap, isWithinCircleReach, lineOfSight, moveCircle, movementCircleColliders, normalize, scale,
  segmentAabbHitFraction, segmentCircleHitFraction, segmentPolygonBoundaryHitFraction, totalAcorns,
  type AcornId, type AcornState, type BerryId, type BerryState, type CircleCollider, type GameEvent, type InputCommand,
  TeamNotificationKind, type InteractionState, type MapDefinition, type MatchEndReason, type MatchPhase, type PlayerId,
  type LobbyKind, type PlayerState, type RolePreference, type ServerMessage, type Team, type ThunderEffectId, type ThunderEffectState,
  type Vec2, type WorldSnapshot
} from '@squirrel-heist/shared';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { RoomMetrics } from '../observability/metrics.js';
import { createLobbyFlowPolicy, type LobbyFlowPolicy } from '../lobby/lobbyFlowPolicy.js';
import { DefaultGameEventDeliveryPolicy, type GameEventDeliveryPolicy, type RoutedGameEvent } from '../events/gameEventDeliveryPolicy.js';

const idleInput: InputCommand = { sequence: -1, clientTick: 0, moveX: 0, moveY: 0, aimX: 1, aimY: 0, buttons: 0 };

export interface RoomOptions {
  id: string;
  seed: string;
  lobbyKind?: LobbyKind;
  teamSeed?: string;
  allowEarlyStart?: boolean;
  countdownMs?: number;
  onEvent?: (event: GameEvent) => void;
  playerIdFactory?: (index: number, control: 'HUMAN' | 'BOT') => PlayerId;
  eventDeliveryPolicy?: GameEventDeliveryPolicy;
}

export interface RoomConnection {
  id: string;
  send(message: ServerMessage): void;
  close?(code: number, reason: string): void;
}

export class MatchRoom {
  readonly id: string;
  readonly lobbyKind: LobbyKind;
  readonly listed: boolean;
  readonly map: MapDefinition;
  readonly metrics = new RoomMetrics();
  phase: MatchPhase = 'LOBBY';
  serverTick = 0;
  nowMs = 0;
  remainingMs: number = gameBalance.matchDurationMs;
  hostPlayerId: PlayerId | null = null;
  winner: Team | null = null;
  endReason: MatchEndReason | null = null;
  readonly players = new Map<PlayerId, PlayerState>();
  readonly acorns = new Map<AcornId, AcornState>();
  readonly berries = new Map<BerryId, BerryState>();
  readonly thunderEffects = new Map<ThunderEffectId, ThunderEffectState>();
  private readonly thunderChargeStartedAtMs = new Map<PlayerId, number>();
  readonly interactions = new Map<PlayerId, InteractionState>();
  readonly connections = new Map<PlayerId, RoomConnection>();
  readonly inputQueues = new Map<PlayerId, InputCommand[]>();
  private readonly testBotPlayerIds = new Set<PlayerId>();
  private readonly random: SeededRandom;
  private readonly teamRandom: SeededRandom;
  private readonly pendingEvents: RoutedGameEvent[] = [];
  private eventSequence = 0;
  private entitySequence = 0;
  private countdownEndsAtMs: number | null = null;
  private allThievesJailedSinceMs: number | null = null;
  private nextBerrySpawnAtMs: number;
  private readonly allowEarlyStart: boolean;
  private readonly countdownMs: number;
  private readonly lobbyFlow: LobbyFlowPolicy;
  private readonly movementBlockers: CircleCollider[];
  private readonly onEvent: (event: GameEvent) => void;
  private readonly playerIdFactory: (index: number, control: 'HUMAN' | 'BOT') => PlayerId;
  private readonly eventDeliveryPolicy: GameEventDeliveryPolicy;

  /** seed 기반 권위 맵과 시뮬레이션 난수열을 만들고 도토리 보존 불변조건의 초기 상태를 구성한다. */
  constructor(options: RoomOptions) {
    this.id = options.id;
    this.lobbyKind = options.lobbyKind ?? 'QUICK_MATCH';
    this.lobbyFlow = createLobbyFlowPolicy(this.lobbyKind);
    this.listed = this.lobbyFlow.listed;
    const generated = generateMap(options.seed);
    this.map = generated.map;
    this.movementBlockers = movementCircleColliders(this.map);
    this.random = new SeededRandom(`${this.map.seed}:simulation`);
    this.teamRandom = new SeededRandom(options.teamSeed ?? randomBytes(16).toString('hex'));
    this.nextBerrySpawnAtMs = this.random.range(gameBalance.berrySpawnMinMs, gameBalance.berrySpawnMaxMs);
    this.allowEarlyStart = options.allowEarlyStart ?? false;
    this.countdownMs = options.countdownMs ?? 3_000;
    this.onEvent = options.onEvent ?? (() => undefined);
    this.playerIdFactory = options.playerIdFactory ?? ((index, control) => `${control === 'BOT' ? 'bot' : 'player'}-${index}-${randomBytes(3).toString('hex')}` as PlayerId);
    this.eventDeliveryPolicy = options.eventDeliveryPolicy ?? new DefaultGameEventDeliveryPolicy();
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

  /** 로비 정원과 역할 예약 상한을 검증하되 실제 팀은 경기 시작 직전에 확정한다. */
  addPlayer(connection: RoomConnection, displayName: string, rolePreference: RolePreference | null = 'RANDOM'): PlayerState {
    if (this.phase !== 'LOBBY') throw new Error('ROOM_ALREADY_STARTED');
    if (this.players.size >= gameBalance.teamSize * 2) throw new Error('ROOM_FULL');
    if (!this.canAcceptRole(rolePreference)) throw new Error(rolePreference === null ? 'ROLE_NOT_ALLOWED' : 'ROLE_FULL');
    const id = this.playerIdFactory(this.players.size + 1, 'HUMAN');
    const player: PlayerState = {
      id, connectionId: connection.id, reconnectToken: randomBytes(16).toString('hex'), displayName, control: 'HUMAN',
      team: null, rolePreference, position: { ...this.map.teamSpawns.THIEF[this.players.size % gameBalance.teamSize]! }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
      mode: 'NORMAL', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0,
      jailedAtMs: null, disconnectedAtMs: null, assetsReady: false, ready: false, lastProcessedInputSequence: -1, lastValidInput: { ...idleInput }
    };
    this.players.set(id, player);
    if (this.lobbyFlow.allowsManualStart && this.hostPlayerId === null) this.hostPlayerId = id;
    this.connections.set(id, connection);
    this.inputQueues.set(id, []);
    this.interactions.set(id, { kind: 'NONE' });
    return player;
  }

  /** 네트워크 연결 없이 입력 adapter가 제어하는 공개 매칭 참가자를 즉시 준비 상태로 등록한다. */
  addBot(displayName: string): PlayerState {
    if (this.phase !== 'LOBBY') throw new Error('ROOM_ALREADY_STARTED');
    if (this.players.size >= gameBalance.teamSize * 2) throw new Error('ROOM_FULL');
    const id = this.playerIdFactory(this.players.size + 1, 'BOT');
    const player: PlayerState = {
      id, connectionId: null, reconnectToken: '', displayName, control: 'BOT', team: null, rolePreference: 'RANDOM',
      position: { ...this.map.teamSpawns.THIEF[this.players.size % gameBalance.teamSize]! }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
      mode: 'NORMAL', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0,
      jailedAtMs: null, disconnectedAtMs: null, assetsReady: true, ready: true, lastProcessedInputSequence: -1, lastValidInput: { ...idleInput }
    };
    this.players.set(id, player);
    this.inputQueues.set(id, []);
    this.interactions.set(id, { kind: 'NONE' });
    this.metrics.botCount += 1;
    this.metrics.botsAdded += 1;
    this.tryBeginCountdown();
    return player;
  }

  /** 자동충원 여부가 활성 인간 연결에만 의존하도록 Room의 제어 유형을 집계한다. */
  get activeHumanCount(): number {
    return [...this.players.values()].filter((player) => player.control === 'HUMAN' && player.connectionId !== null).length;
  }

  /** 재접속 유예 중인 인간을 포함해 bot 전용 Room 회수 시점을 권위 Room 시간으로 판단한다. */
  hasLiveOrReconnectableHuman(): boolean {
    return [...this.players.values()].some((player) => player.control === 'HUMAN' &&
      (player.connectionId !== null || (player.disconnectedAtMs !== null && this.nowMs - player.disconnectedAtMs <= gameBalance.reconnectGraceMs)));
  }

  /** 내장 runtime이 관리해야 할 봇 참가자만 안정된 입장 순서로 반환한다. */
  get botPlayers(): PlayerState[] { return [...this.players.values()].filter((player) => player.control === 'BOT'); }

  /** 인간이 모두 떠난 Room을 회수하기 전에 bot의 입력 queue와 상호작용 상태를 함께 제거한다. */
  removeBots(): void {
    for (const player of this.botPlayers) {
      this.players.delete(player.id);
      this.connections.delete(player.id);
      this.inputQueues.delete(player.id);
      this.interactions.delete(player.id);
    }
    this.metrics.botCount = 0;
  }

  /** 명시 역할은 팀별 네 자리까지만 예약하고 랜덤은 남은 어느 팀에도 배정 가능하게 둔다. */
  canAcceptRole(rolePreference: RolePreference | null): boolean {
    if (this.phase !== 'LOBBY' || this.players.size >= gameBalance.teamSize * 2) return false;
    return this.lobbyFlow.canAcceptRole([...this.players.values()], rolePreference);
  }

  /** 모든 선택을 시작 직전에 4:4로 확정하고 각 팀 spawn 원 내부의 안전한 랜덤 좌표를 부여한다. */
  private assignRoles(): void {
    const players = [...this.players.values()];
    if (players.some((player) => player.rolePreference === null)) throw new Error('ROLE_NOT_SELECTED');
    for (const player of players) player.team = player.rolePreference === 'RANDOM' ? null : player.rolePreference;
    const randomPlayers = players.filter((player) => player.rolePreference === 'RANDOM');
    for (let index = randomPlayers.length - 1; index > 0; index -= 1) {
      const swap = this.teamRandom.integer(0, index + 1);
      [randomPlayers[index], randomPlayers[swap]] = [randomPlayers[swap]!, randomPlayers[index]!];
    }
    const targetPolice = Math.min(gameBalance.teamSize, Math.ceil(players.length / 2));
    let policeCount = players.filter((player) => player.team === 'POLICE').length;
    for (const player of randomPlayers) {
      player.team = policeCount < targetPolice ? 'POLICE' : 'THIEF';
      if (player.team === 'POLICE') policeCount += 1;
    }
    const occupied: Vec2[] = [];
    const teamIndexes: Record<Team, number> = { POLICE: 0, THIEF: 0 };
    for (const player of players) {
      const team = player.team!;
      const center = this.map.teamSpawns[team][teamIndexes[team]++]!;
      player.position = this.findPlayerSpawn(center, team, occupied);
      occupied.push(player.position);
    }
  }

  /** 맵 hash와 asset 준비를 확인하며 공개 매칭 참가자는 선택 완료 상태이므로 자동 준비시킨다. */
  setAssetsReady(playerId: PlayerId, mapHash: string, assetsReady: boolean): boolean {
    const player = this.players.get(playerId);
    if (!player || mapHash !== this.map.hash || !assetsReady) return false;
    player.assetsReady = true;
    this.lobbyFlow.applyAssetsReady(player);
    this.tryBeginCountdown();
    return true;
  }

  /** 친구 Room에서는 역할 선택을 자유롭게 공유하되 변경 시 기존 준비를 취소한다. */
  setRolePreference(playerId: PlayerId, rolePreference: Team): boolean {
    const player = this.players.get(playerId);
    if (!player || !this.lobbyFlow.allowsRoleSelection || this.phase !== 'LOBBY') return false;
    player.rolePreference = rolePreference;
    player.ready = false;
    return true;
  }

  /** 친구 Room 준비 시점에 역할별 네 자리 상한을 검증해 초과 선택자는 다른 역할을 고르게 한다. */
  setPlayerReady(playerId: PlayerId, ready: boolean): boolean {
    const player = this.players.get(playerId);
    if (!player || this.phase !== 'LOBBY') return false;
    const rejected = this.lobbyFlow.validateReady([...this.players.values()], player, ready);
    if (rejected) throw new Error(rejected);
    player.ready = ready;
    return true;
  }

  /** 친구 Room 방장만 전원 연결·asset·준비와 정확한 4:4 선택을 확인한 뒤 시작할 수 있다. */
  startMatch(playerId: PlayerId): boolean {
    if (!this.lobbyFlow.allowsManualStart || this.phase !== 'LOBBY') return false;
    if (this.hostPlayerId !== playerId) throw new Error('HOST_ONLY');
    if (!this.canStartPrivateMatch()) throw new Error('PLAYERS_NOT_READY');
    this.beginCountdown();
    return true;
  }

  /** 현재 방장이 선택한 연결 중 참가자에게 친구 Room 방장 권한을 이전한다. */
  transferHost(playerId: PlayerId, targetPlayerId: PlayerId): boolean {
    if (!this.lobbyFlow.allowsManualStart || this.phase !== 'LOBBY') return false;
    if (this.hostPlayerId !== playerId) throw new Error('HOST_ONLY');
    const target = this.players.get(targetPlayerId);
    if (!target || target.connectionId === null || target.id === playerId) throw new Error('HOST_TRANSFER_REJECTED');
    this.hostPlayerId = target.id;
    return true;
  }

  /** 비공개 Room의 수동 시작 버튼 활성 조건을 서버 권위와 동일하게 계산한다. */
  canStartPrivateMatch(): boolean {
    const required = this.allowEarlyStart ? Math.max(1, this.players.size) : gameBalance.teamSize * 2;
    return this.lobbyFlow.canManualStart([...this.players.values()], required);
  }

  /** Room 정원·연결·asset·사용자 준비를 모두 만족할 때만 역할 확정 직전 countdown을 연다. */
  private tryBeginCountdown(): void {
    const required = this.allowEarlyStart ? Math.max(1, this.players.size) : gameBalance.teamSize * 2;
    if (this.phase === 'LOBBY' && this.lobbyFlow.shouldAutoStart([...this.players.values()], required)) this.beginCountdown();
  }

  /** LOBBY에서 COUNTDOWN으로 한 번만 전이하고 종료 시각을 모든 연결에 알린다. */
  beginCountdown(): void {
    if (this.phase !== 'LOBBY') return;
    this.assignRoles();
    this.phase = 'COUNTDOWN';
    this.countdownEndsAtMs = this.nowMs + this.countdownMs;
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner: null, reason: null, countdownEndsAtMs: this.countdownEndsAtMs }, this.id));
  }

  /** 테스트·시연 모드에서 종료 상태를 제외한 Room을 즉시 PLAYING으로 전환한다. */
  startImmediately(): void {
    if (this.phase === 'FINISHED' || this.phase === 'CLOSED') return;
    this.assignRoles();
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
      this.broadcast(envelope('S2C_MATCH_PHASE', { phase: 'PLAYING' as MatchPhase, winner: null, reason: null }, this.id));
    }
    this.expireDisconnectedPlayers();
    if (this.phase === 'PLAYING') {
      this.updateTimers();
      this.processInputsAndMovement(deltaMs);
      this.processInteractions(deltaMs);
      this.expireThunderEffects();
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
        if ((next.buttons & InputButton.FIRE) !== 0 && (previousButtons & InputButton.FIRE) === 0) this.startThunderCharge(player, next);
      }
      const input = player.lastValidInput;
      this.advanceThunderCharge(player, input);
      const direction = clampMagnitude({ x: input.moveX, y: input.moveY });
      if (player.mode !== 'NORMAL') {
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const carryMultiplier = player.heldAcornId ? gameBalance.carrySpeedMultiplier : 1;
      player.velocity = scale(direction, gameBalance.playerSpeed * carryMultiplier);
      player.position = moveCircle(
        player.position, scale(player.velocity, deltaMs / 1_000), gameBalance.playerRadius,
        this.map.bounds, this.map.staticColliders, this.map.playableArea, this.map.playableHoles,
        this.movementBlockers
      );
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
        this.teamNotification(TeamNotificationKind.ACORN_SECURED, player.id, 'THIEF');
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
    if (player.team === 'THIEF' && this.stealCarriedPoliceAcorn(player)) return;
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
    const takenFromPoliceStorage = acorn.location.kind === 'POLICE_STORAGE';
    acorn.location = { kind: 'CARRIED', carrierId: player.id };
    player.heldAcornId = acorn.id;
    this.event('ACORN_PICKED_UP', { playerId: player.id, acornId: acorn.id });
    if (takenFromPoliceStorage) this.teamNotification(TeamNotificationKind.POLICE_ACORN_STOLEN, player.id, 'POLICE');
  }

  /** 도둑이 가까운 경찰 운반자를 먼저 골라 시야·보유 관계를 확인한 뒤 도토리를 원자적으로 탈취한다. */
  private stealCarriedPoliceAcorn(thief: PlayerState): boolean {
    const carrier = [...this.players.values()]
      .filter((player) => player.team === 'POLICE' && player.heldAcornId !== null &&
        distanceSquared(thief.position, player.position) <= gameBalance.carriedAcornStealRadius ** 2 &&
        lineOfSight(thief.position, player.position, this.map.staticColliders, this.movementBlockers))
      .sort((first, second) => distanceSquared(thief.position, first.position) - distanceSquared(thief.position, second.position))[0];
    if (!carrier?.heldAcornId) return false;
    const acorn = this.acorns.get(carrier.heldAcornId);
    if (!acorn || acorn.location.kind !== 'CARRIED' || acorn.location.carrierId !== carrier.id) return false;
    carrier.heldAcornId = null;
    acorn.location = { kind: 'CARRIED', carrierId: thief.id };
    thief.heldAcornId = acorn.id;
    this.event('ACORN_STOLEN', { playerId: thief.id, targetId: carrier.id, acornId: acorn.id });
    this.teamNotification(TeamNotificationKind.POLICE_CARRIED_ACORN_STOLEN, thief.id, 'POLICE', carrier.id);
    return true;
  }

  /** 운반 도토리를 가장 가까운 유효 필드 좌표로 옮기고 양방향 보유 관계를 해제한다. */
  private dropHeldAcorn(player: PlayerState, origin: Vec2): void {
    if (!player.heldAcornId) return;
    const position = findNearestValidPosition(
      origin, 0.25, this.map.bounds, this.map.staticColliders, this.map.playableArea, this.map.playableHoles,
      this.movementBlockers
    );
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
      distanceSquared(actor.position, target.position) <= gameBalance.arrestRadius ** 2 && lineOfSight(
        actor.position, target.position, this.map.staticColliders,
        this.movementBlockers
      );
  }

  /** 도토리를 먼저 안전하게 떨어뜨린 뒤 감옥 슬롯 이동과 관련 상호작용 취소를 원자적으로 적용한다. */
  private completeArrest(actor: PlayerState, target: PlayerState): void {
    this.cancelThunderCharge(target, 'ARRESTED');
    this.dropHeldAcorn(target, target.position);
    const jailedCount = [...this.players.values()].filter((player) => player.team === 'THIEF' && player.mode === 'JAILED').length;
    target.position = { ...this.map.jail.slots[Math.min(jailedCount, this.map.jail.slots.length - 1)]! };
    target.velocity = { x: 0, y: 0 };
    target.mode = 'JAILED';
    target.jailedAtMs = this.nowMs;
    this.interactions.set(actor.id, { kind: 'NONE' });
    this.cancelInteractionsTargeting(target.id, 'TARGET_JAILED');
    this.event('ARREST_COMPLETED', { actorId: actor.id, targetId: target.id });
    this.teamNotification(TeamNotificationKind.THIEF_ARRESTED, actor.id, 'POLICE', target.id);
  }

  /** 감옥 프리팹 외곽에서 하나의 hold를 진행하고 완료 시 현재 수감된 도둑 전원을 탈출시킨다. */
  private advanceRescue(actor: PlayerState, deltaMs: number): void {
    if (!isWithinCircleReach(actor.position, this.map.jail, gameBalance.interactionRadius)) { this.cancelInteraction(actor.id, 'OUT_OF_RANGE'); return; }
    const jailed = [...this.players.values()].filter((player) => player.team === 'THIEF' && player.mode === 'JAILED').sort((a, b) => (a.jailedAtMs ?? 0) - (b.jailedAtMs ?? 0));
    const target = jailed[0];
    if (!target) { this.cancelInteraction(actor.id, 'NO_TARGET'); return; }
    const current = this.interactions.get(actor.id)!;
    const next: InteractionState = current.kind === 'RESCUE' && current.targetId === target.id
      ? { ...current, progressMs: current.progressMs + deltaMs }
      : { kind: 'RESCUE', actorId: actor.id, targetId: target.id, startedAtTick: this.serverTick, progressMs: deltaMs };
    this.interactions.set(actor.id, next);
    if (next.progressMs >= gameBalance.rescueHoldMs) this.completeRescue(actor);
  }

  /** 완료 시점의 수감자를 모두 서로 다른 탈출점으로 옮기고 같은 체포 면역을 부여한다. */
  private completeRescue(actor: PlayerState): void {
    const jailed = [...this.players.values()].filter((player) => player.team === 'THIEF' && player.mode === 'JAILED')
      .sort((first, second) => (first.jailedAtMs ?? 0) - (second.jailedAtMs ?? 0));
    const available = [...this.map.jail.escapePoints];
    for (const target of jailed) {
      const point = available.find((candidate) => [...this.players.values()].every((player) => player.id === target.id || player.mode === 'JAILED' ||
        distanceSquared(player.position, candidate) > (gameBalance.playerRadius * 2) ** 2)) ?? available[0] ?? this.map.jail.escapePoints[0]!;
      const index = available.indexOf(point);
      if (index >= 0) available.splice(index, 1);
      target.position = { ...point };
      target.mode = 'NORMAL';
      target.jailedAtMs = null;
      target.arrestImmuneUntilMs = this.nowMs + gameBalance.rescueArrestImmunityMs;
      this.event('RESCUE_COMPLETED', { actorId: actor.id, targetId: target.id, position: point });
      this.teamNotification(TeamNotificationKind.THIEF_ESCAPED, actor.id, 'POLICE', target.id);
    }
    this.interactions.set(actor.id, { kind: 'NONE' });
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

  /** 보유 자원을 소비하고 현재 facing의 첫 장애물·상대만 즉시 판정하는 서버 권위 hitscan을 실행한다. */
  private startThunderCharge(player: PlayerState, input: InputCommand): void {
    if (!player.hasThunder || player.mode !== 'NORMAL' || !player.team || input.moveX !== 0 || input.moveY !== 0) return;
    this.thunderChargeStartedAtMs.set(player.id, this.nowMs);
    player.mode = 'CHARGING';
    player.velocity = { x: 0, y: 0 };
    this.cancelInteraction(player.id, 'THUNDER_CHARGING');
    this.event('THUNDER_CHARGE_STARTED', { playerId: player.id });
  }

  /** 정지·버튼 유지가 끊기면 차지를 취소하고, 완료 순간의 최신 aiming으로만 hitscan을 발사한다. */
  private advanceThunderCharge(player: PlayerState, input: InputCommand): void {
    const startedAtMs = this.thunderChargeStartedAtMs.get(player.id);
    if (startedAtMs === undefined) return;
    const holdingFire = (input.buttons & InputButton.FIRE) !== 0;
    if (player.mode !== 'CHARGING' || !holdingFire || input.moveX !== 0 || input.moveY !== 0) {
      this.cancelThunderCharge(player, !holdingFire ? 'RELEASED' : player.mode === 'CHARGING' ? 'MOVED' : 'INTERRUPTED');
      return;
    }
    if (this.nowMs - startedAtMs < gameBalance.thunderChargeMs) return;
    this.thunderChargeStartedAtMs.delete(player.id);
    player.mode = 'NORMAL';
    this.fireThunder(player);
  }

  /** 차지 상태와 이동 불가 모드를 원자적으로 해제하며 소비 전 취소는 썬더를 보존한다. */
  private cancelThunderCharge(player: PlayerState, reason: 'RELEASED' | 'MOVED' | 'INTERRUPTED' | 'ARRESTED'): void {
    if (!this.thunderChargeStartedAtMs.delete(player.id)) return;
    if (player.mode === 'CHARGING') player.mode = 'NORMAL';
    this.event('THUNDER_CHARGE_CANCELLED', { playerId: player.id, reason });
  }

  /** 보유 자원을 소비하고 현재 facing의 첫 장애물·상대만 즉시 판정하는 서버 권위 hitscan을 실행한다. */
  private fireThunder(player: PlayerState): void {
    if (!player.hasThunder || player.mode !== 'NORMAL' || !player.team) return;
    player.hasThunder = false;
    const start = add(player.position, scale(player.facing, gameBalance.playerRadius + 0.2));
    const maximumEnd = add(start, scale(player.facing, gameBalance.thunderRange));
    const obstacleWallFraction = this.map.staticColliders.reduce<number | null>((closest, box) => {
      const padding = gameBalance.thunderHitRadius;
      const hit = segmentAabbHitFraction(start, maximumEnd, {
        min: { x: box.min.x - padding, y: box.min.y - padding },
        max: { x: box.max.x + padding, y: box.max.y + padding }
      });
      return hit === null || (closest !== null && closest <= hit) ? closest : hit;
    }, null);
    const circleWallFraction = this.movementBlockers.reduce<number | null>((closest, blocker) => {
      const radius = blocker.radius + gameBalance.thunderHitRadius;
      const hit = distanceSquared(start, blocker.center) <= radius ** 2 ? 0 : segmentCircleHitFraction(start, maximumEnd, blocker.center, radius);
      return hit === null || (closest !== null && closest <= hit) ? closest : hit;
    }, null);
    const boundaryFractions = [
      segmentPolygonBoundaryHitFraction(start, maximumEnd, this.map.playableArea),
      ...this.map.playableHoles.map((hole) => segmentPolygonBoundaryHitFraction(start, maximumEnd, hole))
    ];
    const boundaryWallFraction = boundaryFractions.reduce<number | null>((closest, hit) =>
      hit === null || hit < 1e-6 || (closest !== null && closest <= hit) ? closest : hit, null);
    const wallFraction = [obstacleWallFraction, circleWallFraction, boundaryWallFraction].reduce<number | null>((closest, hit) =>
      hit === null || (closest !== null && closest <= hit) ? closest : hit, null);
    const playerHit = [...this.players.values()]
      .filter((candidate) => candidate.id !== player.id && candidate.team !== player.team && candidate.mode !== 'JAILED')
      .map((candidate) => ({ player: candidate, fraction: segmentCircleHitFraction(start, maximumEnd, candidate.position, gameBalance.playerRadius + gameBalance.thunderHitRadius) }))
      .filter((candidate): candidate is { player: PlayerState; fraction: number } => candidate.fraction !== null)
      .sort((a, b) => a.fraction - b.fraction)[0];
    const hitsPlayer = playerHit !== undefined && (wallFraction === null || playerHit.fraction < wallFraction);
    const hitFraction = hitsPlayer ? playerHit.fraction : wallFraction ?? 1;
    const end = add(start, scale({ x: maximumEnd.x - start.x, y: maximumEnd.y - start.y }, hitFraction));
    const id = `thunder-${++this.entitySequence}` as ThunderEffectId;
    this.thunderEffects.set(id, {
      id, ownerId: player.id, team: player.team, start, end, spawnedAtTick: this.serverTick,
      expiresAtMs: this.nowMs + gameBalance.thunderBeamDurationMs, hitPlayerId: hitsPlayer ? playerHit.player.id : null
    });
    this.event('THUNDER_FIRED', { playerId: player.id, effectId: id, start, end });
    if (hitsPlayer) {
      const hit = playerHit.player;
      this.cancelThunderCharge(hit, 'INTERRUPTED');
      hit.mode = 'STUNNED';
      hit.stunUntilMs = Math.max(hit.stunUntilMs, this.nowMs + gameBalance.thunderStunMs);
      hit.velocity = { x: 0, y: 0 };
      this.cancelInteraction(hit.id, 'STUNNED');
      this.cancelInteractionsTargeting(hit.id, 'TARGET_STUNNED');
      this.event('THUNDER_HIT', { effectId: id, targetId: hit.id });
    } else if (wallFraction !== null) this.event('THUNDER_HIT_WALL', { effectId: id, position: end });
  }

  /** 짧은 시각 표현 수명이 끝난 hitscan 선만 제거하며 명중 판정은 발사 tick에 이미 끝난다. */
  private expireThunderEffects(): void {
    for (const [id, effect] of this.thunderEffects) if (this.nowMs >= effect.expiresAtMs) this.thunderEffects.delete(id);
  }

  /** seed 난수 일정으로 서로 떨어진 berry를 생성하고 접촉한 정상 플레이어에게 최대 하나의 썬더를 부여한다. */
  private processBerries(): void {
    if (this.nowMs >= this.nextBerrySpawnAtMs && this.berries.size < gameBalance.maxActiveBerries) {
      const active = [...this.berries.values()];
      const available = this.map.berrySpawnPoints.filter((point) => active.every((berry) =>
        distanceSquared(point, berry.position) >= (gameBalance.berryActiveMinSeparation + gameBalance.berrySpawnRadius) ** 2
      ));
      const center = this.selectBerryCenter(available, active);
      const position = center ? this.findBerrySpawn(center) : null;
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

  /** 팀 spawn 중심의 원 안에서 벽·hole·줄기·다른 플레이어와 겹치지 않는 면적 균등 좌표를 선택한다. */
  private findPlayerSpawn(center: Vec2, team: Team, occupied: Vec2[]): Vec2 {
    const spawnRadius = team === 'POLICE' ? gameBalance.policeSpawnRadius : gameBalance.playerSpawnRadius;
    for (let attempt = 0; attempt < 96; attempt += 1) {
      const candidate = this.randomPointInDisk(center, spawnRadius);
      if (isCircleInPlayableArea(candidate, gameBalance.playerRadius, this.map.bounds, this.map.playableArea, this.map.playableHoles) &&
        !this.map.staticColliders.some((box) => circleIntersectsAabb(candidate, gameBalance.playerRadius, box)) &&
        !this.movementBlockers.some((blocker) => circleIntersectsCircle(candidate, gameBalance.playerRadius, blocker.center, blocker.radius)) &&
        occupied.every((point) => distanceSquared(candidate, point) >= (gameBalance.playerRadius * 2) ** 2)) return candidate;
    }
    throw new Error('PLAYER_SPAWN_NOT_FOUND');
  }

  /** 이미 등장한 berry와 가장 멀리 떨어진 후보 중심을 선택해 넓은 맵 전역에 보급품을 분산한다. */
  private selectBerryCenter(candidates: Vec2[], active: BerryState[]): Vec2 | null {
    if (candidates.length === 0) return null;
    if (active.length === 0) return candidates[this.random.integer(0, candidates.length)]!;
    let farthestDistance = -1;
    let farthest: Vec2[] = [];
    for (const candidate of candidates) {
      const nearestDistance = Math.min(...active.map((berry) => distanceSquared(candidate, berry.position)));
      if (nearestDistance > farthestDistance) { farthestDistance = nearestDistance; farthest = [candidate]; }
      else if (nearestDistance === farthestDistance) farthest.push(candidate);
    }
    return farthest[this.random.integer(0, farthest.length)]!;
  }

  /** berry spawn 중심의 원 안에서 현재 장애물과 활성 berry를 피하는 좌표를 선택한다. */
  private findBerrySpawn(center: Vec2): Vec2 | null {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = this.randomPointInDisk(center, gameBalance.berrySpawnRadius);
      if (isCircleInPlayableArea(candidate, gameBalance.berryPickupRadius, this.map.bounds, this.map.playableArea, this.map.playableHoles) &&
        !this.map.staticColliders.some((box) => circleIntersectsAabb(candidate, gameBalance.berryPickupRadius, box)) &&
        !this.movementBlockers.some((blocker) => circleIntersectsCircle(candidate, gameBalance.berryPickupRadius, blocker.center, blocker.radius)) &&
        [...this.berries.values()].every((berry) => distanceSquared(candidate, berry.position) >= gameBalance.berryActiveMinSeparation ** 2)) return candidate;
    }
    return null;
  }

  /** sqrt 반지름 분포로 원의 중심에 치우치지 않는 결정론적 랜덤 좌표를 만든다. */
  private randomPointInDisk(center: Vec2, radius: number): Vec2 {
    const angle = this.random.next() * Math.PI * 2;
    const distance = Math.sqrt(this.random.next()) * radius;
    return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
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
    this.thunderEffects.clear();
    this.event('MATCH_FINISHED', { winner, reason });
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: this.phase, winner, reason }, this.id));
  }

  /** 연결만 분리하고 플레이어 권위 상태는 grace period 동안 보존하되 입력은 즉시 중립화한다. */
  disconnect(playerId: PlayerId, connectionId?: string): void {
    const player = this.players.get(playerId);
    if (!player || (connectionId !== undefined && player.connectionId !== connectionId)) return;
    this.cancelThunderCharge(player, 'INTERRUPTED');
    player.connectionId = null;
    player.disconnectedAtMs = this.nowMs;
    player.lastValidInput = { ...idleInput };
    this.connections.delete(playerId);
    if (this.hostPlayerId === playerId) this.assignNextHost(playerId);
    if (this.phase === 'COUNTDOWN') {
      this.phase = 'LOBBY';
      this.countdownEndsAtMs = null;
      for (const remaining of this.players.values()) remaining.team = null;
      this.broadcast(envelope('S2C_MATCH_PHASE', { phase: 'LOBBY' as MatchPhase, winner: null, reason: null }, this.id));
    }
  }

  /** 경기 시작 전 명시적 이탈자를 즉시 제거하고 countdown을 되돌리며 마지막 인원이 나가면 Room을 종료한다. */
  leaveLobby(playerId: PlayerId, connectionId: string): boolean {
    if (this.phase !== 'LOBBY' && this.phase !== 'COUNTDOWN') return false;
    const player = this.players.get(playerId);
    if (!player || player.connectionId !== connectionId) return false;
    this.cancelThunderCharge(player, 'INTERRUPTED');
    this.players.delete(playerId);
    this.connections.delete(playerId);
    this.inputQueues.delete(playerId);
    this.interactions.delete(playerId);
    if (this.hostPlayerId === playerId) this.assignNextHost(playerId);
    if (this.phase === 'COUNTDOWN') {
      this.phase = 'LOBBY';
      this.countdownEndsAtMs = null;
      for (const remaining of this.players.values()) remaining.team = null;
      this.broadcast(envelope('S2C_MATCH_PHASE', { phase: 'LOBBY' as MatchPhase, winner: null, reason: null }, this.id));
    }
    if (this.players.size === 0) this.closeAbandoned();
    return true;
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
    this.broadcast(envelope('S2C_MATCH_PHASE', { phase: 'CLOSED' as MatchPhase, winner: null, reason: null }, this.id));
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
    this.tryBeginCountdown();
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
          if (this.hostPlayerId === player.id) this.assignNextHost(player.id);
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
      phase: this.phase, remainingMs: this.remainingMs, hostPlayerId: this.hostPlayerId,
      players: [...this.players.values()].map(({ connectionId: _connection, reconnectToken: _token, lastValidInput: _input, control: _control, ...player }) => ({ ...player })),
      acorns: [...this.acorns.values()], berries: [...this.berries.values()], thunderEffects: [...this.thunderEffects.values()],
      interactions: [...this.interactions].map(([id, state]) => ({ playerId: id, state })),
      thiefSecuredCount: [...this.acorns.values()].filter((acorn) => acorn.location.kind === 'SECURED').length
    };
  }

  /** 재접속·resync에 필요한 맵과 현재 snapshot을 하나의 전체 상태 메시지로 만든다. */
  fullStateFor(playerId: PlayerId): ServerMessage {
    return envelope('S2C_FULL_STATE', { map: this.map, snapshot: this.snapshotFor(playerId) }, this.id);
  }

  /** 경기 중 채팅만 서버가 길이·발신자·phase를 확정해 같은 Room의 활성 연결 전체에 중계한다. */
  sendChat(playerId: PlayerId, rawText: string): boolean {
    const player = this.players.get(playerId);
    const text = rawText.trim();
    if (this.phase !== 'PLAYING' || !player || player.connectionId === null || text.length === 0 || text.length > gameBalance.maxChatLength) return false;
    this.broadcast(envelope('S2C_CHAT_MESSAGE', { senderId: player.id, displayName: player.displayName, team: player.team!, text }, this.id));
    return true;
  }

  /** 연결별 ack가 다르므로 각 플레이어 전용 snapshot을 생성해 전송한다. */
  private broadcastSnapshots(): void {
    for (const [playerId, connection] of this.connections) connection.send(envelope('S2C_WORLD_SNAPSHOT', this.snapshotFor(playerId), this.id));
  }

  /** Room의 모든 활성 연결에 동일한 서버 메시지를 보낸다. */
  private broadcast(message: ServerMessage): void { for (const connection of this.connections.values()) connection.send(message); }
  /** 방장 이탈·연결 종료 시 입장 순서상 다음 연결 참가자에게 권한을 자동 승계한다. */
  private assignNextHost(excludedPlayerId: PlayerId): void {
    if (!this.lobbyFlow.allowsManualStart) { this.hostPlayerId = null; return; }
    this.hostPlayerId = [...this.players.values()].find((candidate) => candidate.id !== excludedPlayerId && candidate.connectionId !== null)?.id ?? null;
  }
  /** Room 내 단조 증가 ID와 tick을 붙여 중복 제거 가능한 전체 공개 도메인 event를 적재한다. */
  private event(type: string, payload: Record<string, unknown>): void {
    const event = { eventId: `${this.id}:${++this.eventSequence}`, type, tick: this.serverTick, payload };
    this.pendingEvents.push({ event, audience: { kind: 'ALL' } });
    this.onEvent(event);
  }
  /** 행동 결과를 해당 팀에만 알리고, observer에는 같은 event를 남겨 권위 로그 순서를 보존한다. */
  private teamNotification(kind: TeamNotificationKind, actorId: PlayerId, recipientTeam: Team, targetId?: PlayerId): void {
    const event: GameEvent = {
      eventId: `${this.id}:${++this.eventSequence}`, type: 'TEAM_NOTIFICATION', tick: this.serverTick,
      payload: { kind, actorId, recipientTeam, ...(targetId ? { targetId } : {}) }
    };
    this.pendingEvents.push({ event, audience: { kind: 'TEAM', team: recipientTeam } });
    this.onEvent(event);
  }
  /** 현재 tick event를 연결별 팀 가시성으로 batch 전송하고 pending queue를 비운다. */
  private flushEvents(): void {
    if (this.pendingEvents.length === 0) return;
    const pending = this.pendingEvents.splice(0);
    for (const [playerId, connection] of this.connections) {
      const team = this.players.get(playerId)?.team;
      const events = pending.filter((item) => this.eventDeliveryPolicy.canDeliver(item, team ?? null)).map((item) => item.event);
      if (events.length > 0) connection.send(envelope('S2C_GAME_EVENTS', { events }, this.id));
    }
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
