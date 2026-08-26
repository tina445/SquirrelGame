import { distanceSquared, gameBalance, normalize, subtract, type Vec2, type ZoneDefinition } from '@squirrel-heist/shared';
import { BotNavigator } from './navigation.js';
import { idleDecision, teamOf, type BotDecision, type BotObservation, type BotPolicy, type BotPolicyKind } from './types.js';

interface Goal { id: string; position: Vec2; score: number; action?: 'ACORN' | 'INTERACT' }

abstract class TacticalPolicy implements BotPolicy {
  abstract readonly kind: BotPolicyKind;
  protected readonly navigator = new BotNavigator();

  abstract chooseGoal(observation: BotObservation): Goal | null;

  /** 목표 선택을 공통 이동·조준·상호작용 입력으로 변환한다. */
  decide(observation: BotObservation): BotDecision {
    if (observation.phase !== 'PLAYING') return idleDecision('disabled');
    if (observation.self.mode === 'CHARGING') {
      const target = this.nearestOpponent(observation);
      return { ...idleDecision('thunder-charge'), aimWorld: target?.visible ? normalize(subtract(target.position, observation.self.position)) : observation.self.facing, fire: true };
    }
    if (observation.self.mode !== 'NORMAL') return idleDecision('disabled');
    const threat = teamOf(observation.self) === 'THIEF' ? this.nearestOpponent(observation) : null;
    const carrierTarget = this.carrierTarget(observation);
    const canCommitToTheft = Boolean(carrierTarget && (observation.self.hasThunder || carrierTarget.mode === 'STUNNED' ||
      distanceSquared(observation.self.position, carrierTarget.position) <= 3 ** 2));
    if (observation.self.heldAcornId && threat?.visible && distanceSquared(observation.self.position, threat.position) < 8 ** 2) {
      const baseDistance = Math.sqrt(distanceSquared(observation.self.position, observation.map.thiefBase.center));
      return {
        goal: 'secure',
        moveWorld: baseDistance <= gameBalance.interactionRadius ? { x: 0, y: 0 } : this.navigator.evadeToward(
          observation.map, observation.self.position, threat.position, observation.map.thiefBase.center
        ),
        aimWorld: normalize(subtract(threat.position, observation.self.position)),
        acorn: baseDistance <= gameBalance.interactionRadius,
        interact: false,
        fire: observation.self.hasThunder && distanceSquared(observation.self.position, threat.position) <= gameBalance.thunderRange ** 2
      };
    }
    if (threat?.visible && !canCommitToTheft && distanceSquared(observation.self.position, threat.position) < 8 ** 2) {
      const away = this.navigator.fleeDirection(observation.map, observation.self.position, threat.position);
      return { ...idleDecision('flee'), moveWorld: away, aimWorld: normalize(subtract(threat.position, observation.self.position)),
        fire: observation.self.hasThunder && threat.visible && distanceSquared(observation.self.position, threat.position) <= gameBalance.thunderRange ** 2 };
    }
    const goal = this.chooseGoal(observation);
    if (!goal) return idleDecision('idle');
    const distance = Math.sqrt(distanceSquared(observation.self.position, goal.position));
    const arrestGoal = goal.action === 'INTERACT' && goal.id.startsWith('arrest:');
    const arrestTarget = arrestGoal ? observation.opponents.find((player) => player.id === goal.id.slice('arrest:'.length)) : undefined;
    const arrestDistance = arrestTarget ? Math.sqrt(distanceSquared(observation.self.position, arrestTarget.position)) : distance;
    const theftGoal = goal.action === 'ACORN' && (goal.id.startsWith('steal-carried:') || goal.id.startsWith('minimap-steal:'));
    const actionReach = goal.action === 'INTERACT' && goal.id === 'rescue'
      ? observation.map.jail.radius + gameBalance.interactionRadius
      : arrestGoal ? gameBalance.arrestRadius : theftGoal ? gameBalance.carriedAcornStealRadius : gameBalance.interactionRadius;
    const arrived = arrestGoal ? arrestDistance <= actionReach : distance <= actionReach;
    // 썬더 기절 대상은 서버 체포 반경에서 즉시 hold하지만, 움직이는 도둑은 더 가까이 붙은 뒤
    // 시작해 무작정 체포 hold를 반복하지 않는다.
    const arrestCommitRadius = arrestTarget?.mode === 'STUNNED' ? gameBalance.arrestRadius : 0.95;
    const keepClosingForArrest = arrestGoal && arrestDistance > arrestCommitRadius;
    const opponent = arrestTarget ?? this.nearestOpponent(observation);
    const navigationTarget = arrestGoal && arrestTarget && arrived ? arrestTarget.position : goal.position;
    // 운반 도둑은 느리지만 계속 이동한다. 4-unit 단위 cache key를 쓰면 경찰이 직전 위치에
    // 도착해 멈춘 뒤에야 경로가 갱신될 수 있으므로, 체포 목표만 반 칸 단위로 추적한다.
    const navigationKey = arrestGoal && arrestTarget
      ? `${goal.id}:${Math.round(arrestTarget.position.x * 2)},${Math.round(arrestTarget.position.y * 2)}`
      : `${goal.id}:${Math.round(navigationTarget.x / 4)},${Math.round(navigationTarget.y / 4)}`;
    const aim = opponent?.visible ? normalize(subtract(opponent.position, observation.self.position)) : normalize(subtract(goal.position, observation.self.position));
    const theftTarget = theftGoal && opponent?.id === goal.id.split(':')[1];
    const followUpFireRange = gameBalance.carriedAcornStealRadius + gameBalance.playerSpeed * gameBalance.thunderStunMs / 1_000 - 0.5;
    const fireRange = theftTarget ? Math.min(gameBalance.thunderRange, followUpFireRange) : gameBalance.thunderRange;
    return {
      goal: goal.id,
      moveWorld: arrived && !keepClosingForArrest ? { x: 0, y: 0 } : this.navigator.direction(
        observation.map,
        observation.self.position,
        navigationTarget,
        navigationKey
      ),
      aimWorld: aim.x === 0 && aim.y === 0 ? observation.self.facing : aim,
      interact: arrived && (!arrestGoal || arrestDistance <= arrestCommitRadius) && goal.action === 'INTERACT', acorn: arrived && goal.action === 'ACORN',
      fire: Boolean(opponent?.visible && observation.self.hasThunder && distanceSquared(observation.self.position, opponent.position) <= fireRange ** 2)
    };
  }

  protected goals(observation: BotObservation): Goal[] {
    const self = observation.self;
    if (teamOf(self) === 'THIEF') {
      if (self.heldAcornId) return [{ id: 'secure', position: observation.map.thiefBase.center, score: 100, action: 'ACORN' }];
      const goals: Goal[] = [];
      const carrier = this.carrierTarget(observation);
      const stunnedCarrier = observation.recentThunderHit && observation.opponents.find((player) => player.id === observation.recentThunderHit!.targetId && player.visible && player.heldAcornId);
      if (stunnedCarrier) goals.push({ id: `steal-carried:${stunnedCarrier.id}`, position: stunnedCarrier.position, score: 97, action: 'ACORN' });
      if (carrier && (self.hasThunder || carrier.mode === 'STUNNED' || distanceSquared(self.position, carrier.position) <= 3 ** 2)) {
        goals.push({ id: `steal-carried:${carrier.id}`, position: carrier.position, score: 96, action: 'ACORN' });
      }
      if (self.hasThunder) for (const carrierMarker of observation.minimapCarriers.filter((item) => this.isResourceScout(observation, item.position))) {
        goals.push({ id: `minimap-steal:${carrierMarker.playerId}`, position: carrierMarker.position, score: 90, action: 'ACORN' });
      }
      const jailedCount = observation.teammates.filter((player) => player.mode === 'JAILED').length;
      if (jailedCount > 0 && this.isDesignatedRescuer(observation)) {
        goals.push({ id: 'rescue', position: observation.map.jail.center, score: 90, action: 'INTERACT' });
      }
      // 도토리 전진을 우선하되, 썬더가 없으면 다음 교전 전에 베리 하나를 준비할 여지는 남긴다.
      for (const acorn of observation.acorns) if (acorn.location.kind === 'GROUND') goals.push({ id: `ground:${acorn.id}`, position: acorn.location.position, score: 65, action: 'ACORN' });
      if (!self.hasThunder) for (const berry of observation.minimapBerries.filter((item) => this.isResourceScout(observation, item.position))) {
        goals.push({ id: `berry:${berry.id}`, position: berry.position, score: 74 });
      }
      if (!self.hasThunder && observation.minimapCarriers.length > 0) for (const berry of observation.minimapBerries.filter((item) => this.isResourceScout(observation, item.position))) {
        goals.push({ id: `counter-berry:${berry.id}`, position: berry.position, score: 90 });
      }
      for (const storage of observation.map.storages) if ((observation.storageAcornCounts[storage.id] ?? 0) > 0) goals.push({ id: `steal:${storage.id}`, position: storage.center, score: 75, action: 'ACORN' });
      if (goals.length === 0) {
        const points = [...observation.map.storages.map((storage) => ({ id: storage.id, position: storage.center })),
          { id: 'jail', position: this.jailApproach(observation) }, { id: 'base', position: observation.map.thiefBase.center }];
        const candidates = [self, ...observation.teammates].filter((player) => player.mode === 'NORMAL').sort((a, b) => a.id.localeCompare(b.id));
        const index = Math.max(0, candidates.findIndex((player) => player.id === self.id));
        const scout = points[index % points.length]!;
        goals.push({ id: `scout:${scout.id}`, position: scout.position, score: 1 });
      }
      return goals;
    }
    if (self.heldAcornId) return observation.map.storages.filter((storage) => (observation.storageAcornCounts[storage.id] ?? 0) < gameBalance.acornsPerStorage)
      .map((storage) => ({ id: `return:${storage.id}`, position: storage.center, score: 100, action: 'ACORN' }));
    const goals: Goal[] = [];
    // 운반자는 우선 추적하고, 빈손 도둑도 가까운 전담 경찰 한 명이 체포한다.
    // 다만 장거리의 일반 추적은 만들지 않아 4명의 경찰이 hold를 반복하는 압박을 줄인다.
    for (const opponent of observation.opponents.filter((player) => player.visible && player.heldAcornId && player.mode !== 'JAILED' && this.isDesignatedArrester(observation, player.id))) goals.push({
      // 운반선 차단 예상점보다 현재 위치를 직접 압박해 실제 체포 시도를 우선한다.
      id: `arrest:${opponent.id}`, position: opponent.position,
      score: 94, action: 'INTERACT'
    });
    for (const opponent of observation.opponents.filter((player) => player.visible && !player.heldAcornId && player.mode !== 'JAILED' &&
      distanceSquared(self.position, player.position) <= 6 ** 2 && this.isDesignatedArrester(observation, player.id))) goals.push({
      id: `arrest:${opponent.id}`, position: opponent.position, score: 88, action: 'INTERACT'
    });
    const stunnedTarget = observation.recentThunderHit && observation.opponents.find((player) => player.id === observation.recentThunderHit!.targetId && player.visible && player.mode !== 'JAILED');
    if (stunnedTarget) goals.push({ id: `arrest:${stunnedTarget.id}`, position: stunnedTarget.position, score: 92, action: 'INTERACT' });
    for (const acorn of observation.acorns) if (acorn.location.kind === 'GROUND') goals.push({ id: `recover:${acorn.id}`, position: acorn.location.position, score: 80, action: 'ACORN' });
    if (!self.hasThunder) for (const berry of observation.minimapBerries.filter((item) => this.isResourceScout(observation, item.position))) {
      // 체포 대상이 없을 때는 회수보다 썬더 준비를 먼저 하되, 발사 규칙 자체는 바꾸지 않는다.
      goals.push({ id: `berry:${berry.id}`, position: berry.position, score: 85 });
    }
    for (const storage of observation.map.storages) goals.push({ id: `patrol:${storage.id}`, position: storage.center, score: 20 + (observation.storageAcornCounts[storage.id] ?? 0) * 2 });
    goals.push({ id: 'patrol:jail', position: this.jailApproach(observation), score: 18 });
    return goals;
  }

  protected nearestOpponent(observation: BotObservation) {
    return [...observation.opponents].sort((a, b) => distanceSquared(observation.self.position, a.position) - distanceSquared(observation.self.position, b.position))[0];
  }
  /** 가시 범위 안에서 실제 탈취 가능한 경찰 운반자만 추적 목표로 만든다. */
  protected carrierTarget(observation: BotObservation) {
    return observation.opponents.filter((player) => player.visible && player.heldAcornId !== null && player.mode !== 'JAILED')
      .sort((a, b) => distanceSquared(observation.self.position, a.position) - distanceSquared(observation.self.position, b.position))[0];
  }
  /** 같은 상대에게 모든 경찰이 달라붙지 않도록, 가장 가까운 정상 경찰 한 명만 체포 hold를 맡긴다. */
  protected isDesignatedArrester(observation: BotObservation, targetId: string): boolean {
    const target = observation.opponents.find((opponent) => opponent.id === targetId);
    if (!target) return false;
    const candidates = [observation.self, ...observation.teammates].filter((player) => player.mode === 'NORMAL')
      .sort((first, second) => distanceSquared(first.position, target.position) - distanceSquared(second.position, target.position) || first.id.localeCompare(second.id));
    return candidates[0]?.id === observation.self.id;
  }
  /** 공개 미니맵 자원은 가장 가까운 정상 팀원 하나만 맡아 전원 우회와 목표 중복을 막는다. */
  protected isResourceScout(observation: BotObservation, position: Vec2): boolean {
    const candidates = [observation.self, ...observation.teammates].filter((player) => player.mode === 'NORMAL')
      .sort((first, second) => distanceSquared(first.position, position) - distanceSquared(second.position, position) || first.id.localeCompare(second.id));
    return candidates[0]?.id === observation.self.id;
  }
  /** 전원 구출 규칙에서는 감옥에 가장 가까운 정상 도둑만 구조를 맡아 나머지의 도토리 전진을 보존한다. */
  protected isDesignatedRescuer(observation: BotObservation): boolean {
    const candidates = [observation.self, ...observation.teammates].filter((player) => player.mode === 'NORMAL')
      .sort((first, second) => distanceSquared(first.position, observation.map.jail.center) - distanceSquared(second.position, observation.map.jail.center) || first.id.localeCompare(second.id));
    return candidates[0]?.id === observation.self.id;
  }
  protected jailApproach(observation: BotObservation): Vec2 { return observation.map.jail.escapePoints[0] ?? observation.map.jail.center; }
  protected distanceTo(observation: BotObservation, position: Vec2): number { return Math.sqrt(distanceSquared(observation.self.position, position)); }
  protected inZone(observation: BotObservation, zone: ZoneDefinition): boolean { return this.distanceTo(observation, zone.center) <= zone.radius; }
}

export class RuleBasedPolicy extends TacticalPolicy {
  readonly kind = 'RULE_BASED' as const;
  private currentGoalId: string | null = null;
  private currentGoalUntilMs = 0;
  /** 역할별 고정 우선순위 안에서 가까운 동률 목표를 선택한다. */
  chooseGoal(observation: BotObservation): Goal | null {
    const goals = this.goals(observation);
    const highest = Math.max(...goals.map((goal) => goal.score));
    const peers = goals.filter((goal) => goal.score === highest).sort((a, b) => a.id.localeCompare(b.id));
    const current = goals.find((goal) => goal.id === this.currentGoalId);
    if (current && observation.nowMs < this.currentGoalUntilMs) return current;
    const peerCurrent = peers.find((goal) => goal.id === this.currentGoalId);
    if (peerCurrent) return peerCurrent;
    if (peers.length > 1 && peers.every((goal) => goal.id.startsWith('steal:') || goal.id.startsWith('patrol:'))) {
      const hash = [...observation.self.id].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0;
      const selected = peers[hash % peers.length] ?? null;
      this.currentGoalId = selected?.id ?? null;
      this.currentGoalUntilMs = observation.nowMs + 1_000;
      return selected;
    }
    const selected = peers.sort((a, b) => this.distanceTo(observation, a.position) - this.distanceTo(observation, b.position))[0] ?? null;
    this.currentGoalId = selected?.id ?? null;
    this.currentGoalUntilMs = observation.nowMs + 1_000;
    return selected;
  }
}

export class GreedyPolicy extends TacticalPolicy {
  readonly kind = 'GREEDY' as const;
  private currentGoalId: string | null = null;

  /** 행동 보상에서 이동 비용·가시 위험·팀원 중복을 빼 매 시점의 효용이 가장 큰 목표를 선택한다. */
  chooseGoal(observation: BotObservation): Goal | null {
    const goals = this.goals(observation).filter((goal) => {
      if (teamOf(observation.self) !== 'POLICE' || !goal.id.startsWith('arrest:')) return true;
      const target = observation.opponents.find((opponent) => opponent.id === goal.id.slice('arrest:'.length));
      // 운반자는 전역 우선 대상으로 유지하되, 일반 도둑은 실제로 가까운 경우만 추격한다.
      // 그 밖의 경우에는 도토리 회수·저장소 순찰의 효용을 비교해 과도한 전장 압박을 피한다.
      return Boolean(target?.heldAcornId) || Boolean(target?.visible && distanceSquared(observation.self.position, target.position) <= 9 ** 2);
    });
    const highestPriority = Math.max(...goals.map((goal) => goal.score));
    // 역할 우선순위를 절대 경계로 삼고 동률 목표에서만 이동 비용을 탐욕적으로 최소화한다.
    // 이 방식은 양 팀이 같은 자원/구조에 과도하게 반응해 승률이 급격히 기울어지는 것을 막는다.
    const candidates = goals.filter((goal) => goal.score === highestPriority).map((goal) => {
      const travelCost = this.distanceTo(observation, goal.position) * 0.35;
      return { ...goal, utility: goal.score - travelCost };
    }).sort((a, b) => b.utility - a.utility);
    const best = candidates[0];
    if (!best) { this.currentGoalId = null; return null; }
    const current = candidates.find((goal) => goal.id === this.currentGoalId);
    if (current && current.utility >= best.utility) return current;
    this.currentGoalId = best.id;
    return best;
  }
}

export function createBotPolicy(kind: BotPolicyKind): BotPolicy { return kind === 'GREEDY' ? new GreedyPolicy() : new RuleBasedPolicy(); }
