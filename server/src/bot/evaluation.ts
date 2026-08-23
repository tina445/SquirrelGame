import { BotController, type BotPolicySelection } from '@squirrel-heist/bot-core';
import {
  InputButton, fixedDeltaMs, gameBalance, generateMap,
  type AcornLocation, type GameEvent, type PlayerId, type ServerMessage, type Team
} from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../simulation/matchRoom.js';

export interface BotQuality {
  stuckRatio: number;
  ineffectiveActionsPerMinute: number;
  oscillations: number;
  decisionErrors: number;
}

export interface BotEvaluationResult {
  seeds: number;
  matches: number;
  layouts: Record<string, number>;
  variants: Record<string, { winnerCounts: Record<Team, number>; averageScores: Record<Team, number>; quality: Record<Team, BotQuality>; averageEvents: Record<string, number> }>;
  recommendation: BotPolicySelection;
}

export interface BotEvaluationSeedSet { seeds: string[]; layouts: Record<string, number> }

interface MatchResult { winner: Team | null; scoreTotals: Record<Team, number>; quality: Record<Team, BotQuality>; eventCounts: Record<string, number> }

class RewardScorer {
  readonly scores = new Map<PlayerId, number>();
  private locations = new Map<string, AcornLocation>();
  private readonly effectOwners = new Map<string, PlayerId>();

  constructor(private readonly room: MatchRoom) {
    for (const player of room.players.values()) this.scores.set(player.id, 0);
    for (const acorn of room.acorns.values()) this.locations.set(acorn.id, acorn.location);
  }

  /** 권위 event와 직전 도토리 상태를 조합해 반복 입력으로 조작할 수 없는 역할별 reward를 계산한다. */
  accept(events: GameEvent[]): void {
    const arrested = new Set(events.filter((event) => event.type === 'ARREST_COMPLETED').map((event) => String(event.payload.targetId)));
    const hitEffects = new Set(events.filter((event) => event.type === 'THUNDER_HIT').map((event) => String(event.payload.effectId)));
    const firedEffects = new Set(events.filter((event) => event.type === 'THUNDER_FIRED').map((event) => String(event.payload.effectId)));
    for (const event of events) {
      const actorId = String(event.payload.playerId ?? event.payload.actorId ?? '') as PlayerId;
      const actor = this.room.players.get(actorId);
      if (event.type === 'ACORN_PICKED_UP' && actor) {
        const previous = this.locations.get(String(event.payload.acornId));
        if (actor.team === 'THIEF' && previous?.kind === 'POLICE_STORAGE') { this.add(actor.id, 10); this.addTeam('POLICE', -3); }
        if (actor.team === 'POLICE' && previous?.kind === 'GROUND') this.add(actor.id, 8);
      }
      if (event.type === 'ACORN_STOLEN' && actor) { this.add(actor.id, 16); this.addTeam('POLICE', -5); }
      if (event.type === 'ACORN_SECURED' && actor) { this.add(actor.id, 40); this.addTeam('POLICE', -8); }
      if (event.type === 'ACORN_RETURNED' && actor) this.add(actor.id, 20);
      if (event.type === 'ACORN_DROPPED' && actor && !arrested.has(actor.id)) this.add(actor.id, -6);
      if (event.type === 'ARREST_COMPLETED') {
        this.add(String(event.payload.actorId) as PlayerId, 30);
        this.add(String(event.payload.targetId) as PlayerId, -25);
      }
      if (event.type === 'RESCUE_COMPLETED') { this.add(String(event.payload.actorId) as PlayerId, 15); this.addTeam('POLICE', -6); }
      if (event.type === 'THUNDER_FIRED') this.effectOwners.set(String(event.payload.effectId), actorId);
      if (event.type === 'THUNDER_HIT') {
        const owner = this.effectOwners.get(String(event.payload.effectId));
        if (owner) this.add(owner, 4);
        this.add(String(event.payload.targetId) as PlayerId, -3);
      }
      if (event.type === 'INTERACTION_CANCELLED' && ['RELEASED', 'OUT_OF_RANGE'].includes(String(event.payload.reason))) this.add(String(event.payload.playerId) as PlayerId, -1);
    }
    for (const effectId of firedEffects) {
      const owner = this.effectOwners.get(effectId);
      if (owner && !hitEffects.has(effectId)) this.add(owner, -2);
    }
    for (const acorn of this.room.acorns.values()) this.locations.set(acorn.id, acorn.location);
  }

  survivalTick(): void {
    for (const player of this.room.players.values()) if (player.team === 'THIEF' && player.mode === 'NORMAL') this.add(player.id, 1);
  }
  private add(id: PlayerId, amount: number): void { this.scores.set(id, (this.scores.get(id) ?? 0) + amount); }
  private addTeam(team: Team, amount: number): void { for (const player of this.room.players.values()) if (player.team === team) this.add(player.id, amount); }
}

function runMatch(seed: string, policies: BotPolicySelection): MatchResult {
  const events: GameEvent[] = [];
  const connection = (id: string): RoomConnection => ({ id, send: (_message: ServerMessage) => undefined });
  const room = new MatchRoom({
    id: `eval-${seed}`, seed, allowEarlyStart: true, countdownMs: 0, onEvent: (event) => events.push(event),
    playerIdFactory: (index) => `eval-player-${index}` as PlayerId
  });
  const players = [
    ...Array.from({ length: gameBalance.teamSize }, (_, index) => room.addPlayer(connection(`thief-${index}`), `thief-${index}`, 'THIEF')),
    ...Array.from({ length: gameBalance.teamSize }, (_, index) => room.addPlayer(connection(`police-${index}`), `police-${index}`, 'POLICE'))
  ];
  room.startImmediately();
  room.connections.clear();
  const controllers = new Map(players.map((player) => [player.id, new BotController(policies[player.team!], `${seed}:${player.id}`)]));
  const scorer = new RewardScorer(room);
  const previousPositions = new Map(players.map((player) => [player.id, { ...player.position }]));
  const stuckMs = new Map<PlayerId, number>();
  const ineffectiveActions = new Map<PlayerId, number>();
  const oscillations = new Map<PlayerId, number>();
  const goalHistory = new Map<PlayerId, Array<{ goal: string; at: number }>>();
  const previousButtons = new Map<PlayerId, number>();
  const eventCounts: Record<string, number> = {};
  const maximumTicks = Math.ceil(gameBalance.matchDurationMs / fixedDeltaMs) + 2;
  for (let tick = 0; tick < maximumTicks && room.phase !== 'FINISHED'; tick += 1) {
    const actions: Array<{ playerId: PlayerId; buttons: number }> = [];
    const world = room.snapshotFor(players[0]!.id);
    for (const player of players) {
      const controller = controllers.get(player.id)!;
      const input = controller.nextInput(room.map, world, player.id);
      actions.push({ playerId: player.id, buttons: input.buttons });
      room.enqueueInput(player.id, input);
      const history = goalHistory.get(player.id) ?? [];
      const tacticalGoal = ['idle', 'flee', 'disabled', 'error'].includes(controller.lastGoal) ? null : controller.lastGoal;
      if (tacticalGoal && history.at(-1)?.goal !== tacticalGoal) history.push({ goal: tacticalGoal, at: room.nowMs });
      while ((history[0]?.at ?? Infinity) < room.nowMs - 3_000) history.shift();
      if (history.length >= 6) { oscillations.set(player.id, (oscillations.get(player.id) ?? 0) + 1); history.splice(0); }
      goalHistory.set(player.id, history);
    }
    room.tick(fixedDeltaMs);
    const tickEvents = events.splice(0);
    for (const event of tickEvents) eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    scorer.accept(tickEvents);
    if ((tick + 1) % Math.round(15_000 / fixedDeltaMs) === 0) scorer.survivalTick();
    const effectiveActors = new Set(tickEvents.flatMap((event) => [String(event.payload.playerId ?? ''), String(event.payload.actorId ?? '')]));
    for (const action of actions) {
      const player = room.players.get(action.playerId)!;
      const previous = previousPositions.get(action.playerId)!;
      const moved = Math.hypot(player.position.x - previous.x, player.position.y - previous.y);
      const goal = controllers.get(player.id)!.lastGoal;
      if (!['idle', 'flee', 'disabled', 'error'].includes(goal) && player.mode === 'NORMAL' &&
        (player.lastValidInput.moveX !== 0 || player.lastValidInput.moveY !== 0) && moved < 0.01) {
        stuckMs.set(player.id, (stuckMs.get(player.id) ?? 0) + fixedDeltaMs);
      }
      previousPositions.set(player.id, { ...player.position });
      const rising = action.buttons & ~(previousButtons.get(player.id) ?? 0);
      if ((rising & (InputButton.ACORN | InputButton.FIRE)) !== 0 && !effectiveActors.has(player.id)) {
        ineffectiveActions.set(player.id, (ineffectiveActions.get(player.id) ?? 0) + 1);
      }
      previousButtons.set(player.id, action.buttons);
    }
  }
  const elapsedMinutes = Math.max(room.nowMs / 60_000, 1 / 60);
  const quality = Object.fromEntries((['THIEF', 'POLICE'] as const).map((team) => {
    const teamPlayers = players.filter((player) => player.team === team);
    return [team, {
      stuckRatio: teamPlayers.reduce((sum, player) => sum + (stuckMs.get(player.id) ?? 0), 0) / Math.max(room.nowMs * teamPlayers.length, 1),
      ineffectiveActionsPerMinute: teamPlayers.reduce((sum, player) => sum + (ineffectiveActions.get(player.id) ?? 0), 0) / teamPlayers.length / elapsedMinutes,
      oscillations: teamPlayers.reduce((sum, player) => sum + (oscillations.get(player.id) ?? 0), 0),
      decisionErrors: teamPlayers.reduce((sum, player) => sum + controllers.get(player.id)!.decisionErrors, 0)
    }];
  })) as unknown as Record<Team, BotQuality>;
  return {
    winner: room.winner,
    scoreTotals: {
      THIEF: [...scorer.scores].filter(([id]) => room.players.get(id)?.team === 'THIEF').reduce((sum, [, score]) => sum + score, 0),
      POLICE: [...scorer.scores].filter(([id]) => room.players.get(id)?.team === 'POLICE').reduce((sum, [, score]) => sum + score, 0)
    },
    quality, eventCounts
  };
}

/** 요청한 seed 수를 일곱 layout 사이 최대 한 개 차이로 분배해 회귀 평가 편향을 막는다. */
export function selectEvaluationSeeds(seedCount: number): BotEvaluationSeedSet {
  const seeds: string[] = [];
  const layouts: Record<string, number> = {};
  const layoutKinds = ['LINE', 'H', 'RING', 'GRAPH', 'CROSS', 'DIAMOND', 'COURTYARD'] as const;
  const baseQuota = Math.floor(seedCount / layoutKinds.length);
  const remainder = seedCount % layoutKinds.length;
  const quotas = Object.fromEntries(layoutKinds.map((kind, index) => [kind, baseQuota + (index < remainder ? 1 : 0)]));
  for (let candidate = 0; seeds.length < seedCount; candidate += 1) {
    const seed = `bot-eval-${candidate}`;
    const kind = generateMap(seed).map.layoutKind;
    if ((layouts[kind] ?? 0) >= (quotas[kind] ?? 0)) continue;
    layouts[kind] = (layouts[kind] ?? 0) + 1;
    seeds.push(seed);
  }
  return { seeds, layouts };
}

/** 동일 상대 정책을 고정한 네 조합을 여러 seed에서 실행하고 역할별 greedy 채택 여부를 결정한다. */
export function evaluateBots(seedCount = 100, onProgress: (completed: number, total: number) => void = () => undefined): BotEvaluationResult {
  const variants: Record<string, BotPolicySelection> = {
    ruleRule: { THIEF: 'RULE_BASED', POLICE: 'RULE_BASED' },
    greedyThief: { THIEF: 'GREEDY', POLICE: 'RULE_BASED' },
    greedyPolice: { THIEF: 'RULE_BASED', POLICE: 'GREEDY' },
    greedyGreedy: { THIEF: 'GREEDY', POLICE: 'GREEDY' }
  };
  const { seeds, layouts } = selectEvaluationSeeds(seedCount);
  const aggregates = Object.fromEntries(Object.keys(variants).map((name) => [name, {
    winnerCounts: { THIEF: 0, POLICE: 0 }, scoreTotals: { THIEF: 0, POLICE: 0 }, eventCounts: {} as Record<string, number>,
    quality: {
      THIEF: { stuckRatio: 0, ineffectiveActionsPerMinute: 0, oscillations: 0, decisionErrors: 0 },
      POLICE: { stuckRatio: 0, ineffectiveActionsPerMinute: 0, oscillations: 0, decisionErrors: 0 }
    }
  }]));
  for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
    const seed = seeds[seedIndex]!;
    for (const [name, selection] of Object.entries(variants)) {
      const result = runMatch(seed, selection);
      const aggregate = aggregates[name]!;
      if (result.winner) aggregate.winnerCounts[result.winner] += 1;
      aggregate.scoreTotals.THIEF += result.scoreTotals.THIEF;
      aggregate.scoreTotals.POLICE += result.scoreTotals.POLICE;
      for (const [type, count] of Object.entries(result.eventCounts)) aggregate.eventCounts[type] = (aggregate.eventCounts[type] ?? 0) + count;
      for (const team of ['THIEF', 'POLICE'] as const) for (const key of Object.keys(aggregate.quality[team]) as Array<keyof BotQuality>) {
        aggregate.quality[team][key] += result.quality[team][key];
      }
    }
    onProgress(seedIndex + 1, seeds.length);
  }
  const normalized = Object.fromEntries(Object.entries(aggregates).map(([name, aggregate]) => [name, {
    winnerCounts: aggregate.winnerCounts,
    averageScores: {
      THIEF: aggregate.scoreTotals.THIEF / seedCount / gameBalance.teamSize,
      POLICE: aggregate.scoreTotals.POLICE / seedCount / gameBalance.teamSize
    },
    averageEvents: Object.fromEntries(Object.entries(aggregate.eventCounts).map(([type, count]) => [type, count / seedCount])),
    quality: Object.fromEntries((['THIEF', 'POLICE'] as const).map((team) => [team,
      Object.fromEntries((Object.keys(aggregate.quality[team]) as Array<keyof BotQuality>).map((key) => [key, aggregate.quality[team][key] / seedCount]))
    ])) as unknown as Record<Team, BotQuality>
  }])) as BotEvaluationResult['variants'];
  const recommendation: BotPolicySelection = { THIEF: 'RULE_BASED', POLICE: 'RULE_BASED' };
  for (const team of ['THIEF', 'POLICE'] as const) {
    const candidateName = team === 'THIEF' ? 'greedyThief' : 'greedyPolice';
    const baseline = normalized.ruleRule!;
    const candidate = normalized[candidateName]!;
    const baselineScore = baseline.averageScores[team];
    const scoreImproved = baselineScore >= 0
      ? candidate.averageScores[team] >= baselineScore * 1.1
      : candidate.averageScores[team] - baselineScore >= Math.abs(baselineScore) * 0.1;
    const candidateWins = candidate.winnerCounts[team] / seedCount;
    const baselineWins = baseline.winnerCounts[team] / seedCount;
    const opponent = team === 'THIEF' ? 'POLICE' : 'THIEF';
    const opponentWins = candidate.winnerCounts[opponent] / seedCount;
    const candidateQuality = candidate.quality[team];
    const qualityPasses = candidateQuality.stuckRatio < 0.05 && candidateQuality.ineffectiveActionsPerMinute <= 6 &&
      candidateQuality.oscillations === 0 && candidateQuality.decisionErrors === 0;
    // 기본 매칭은 한 역할이 60%를 넘거나 상대가 40% 미만으로 내려가면 채택하지 않는다.
    const matchupIsBalanced = candidateWins >= 0.4 && candidateWins <= 0.6 && opponentWins >= 0.4 && opponentWins <= 0.6;
    if (scoreImproved && candidateWins >= baselineWins - 0.03 && qualityPasses && matchupIsBalanced) recommendation[team] = 'GREEDY';
  }
  return { seeds: seedCount, matches: seedCount * Object.keys(variants).length, layouts, variants: normalized, recommendation };
}
