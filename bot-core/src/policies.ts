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
    if (observation.phase !== 'PLAYING' || observation.self.mode !== 'NORMAL') return idleDecision('disabled');
    const threat = teamOf(observation.self) === 'THIEF' ? this.nearestOpponent(observation) : null;
    if (threat && distanceSquared(observation.self.position, threat.position) < 8 ** 2) {
      const away = normalize(subtract(observation.self.position, threat.position));
      return { ...idleDecision('flee'), moveWorld: away, aimWorld: normalize(subtract(threat.position, observation.self.position)),
        fire: observation.self.hasThunder && threat.visible && distanceSquared(observation.self.position, threat.position) <= gameBalance.thunderRange ** 2 };
    }
    const goal = this.chooseGoal(observation);
    if (!goal) return idleDecision('idle');
    const distance = Math.sqrt(distanceSquared(observation.self.position, goal.position));
    const actionReach = goal.action === 'INTERACT' && goal.id === 'rescue' ? observation.map.jail.radius + gameBalance.interactionRadius : gameBalance.interactionRadius;
    const arrived = distance <= actionReach;
    const opponent = this.nearestOpponent(observation);
    const aim = opponent?.visible ? normalize(subtract(opponent.position, observation.self.position)) : normalize(subtract(goal.position, observation.self.position));
    return {
      goal: goal.id,
      moveWorld: arrived ? { x: 0, y: 0 } : this.navigator.direction(
        observation.map,
        observation.self.position,
        goal.position,
        `${goal.id}:${Math.round(goal.position.x / 4)},${Math.round(goal.position.y / 4)}`
      ),
      aimWorld: aim.x === 0 && aim.y === 0 ? observation.self.facing : aim,
      interact: arrived && goal.action === 'INTERACT', acorn: arrived && goal.action === 'ACORN',
      fire: Boolean(opponent?.visible && observation.self.hasThunder && distanceSquared(observation.self.position, opponent.position) <= gameBalance.thunderRange ** 2)
    };
  }

  protected goals(observation: BotObservation): Goal[] {
    const self = observation.self;
    if (teamOf(self) === 'THIEF') {
      if (self.heldAcornId) return [{ id: 'secure', position: observation.map.thiefBase.center, score: 100, action: 'ACORN' }];
      const goals: Goal[] = [];
      if (observation.teammates.some((player) => player.mode === 'JAILED')) goals.push({ id: 'rescue', position: observation.map.jail.center, score: 70, action: 'INTERACT' });
      for (const acorn of observation.acorns) if (acorn.location.kind === 'GROUND') goals.push({ id: `ground:${acorn.id}`, position: acorn.location.position, score: 45, action: 'ACORN' });
      for (const storage of observation.map.storages) if ((observation.storageAcornCounts[storage.id] ?? 0) > 0) goals.push({ id: `steal:${storage.id}`, position: storage.center, score: 60, action: 'ACORN' });
      return goals;
    }
    if (self.heldAcornId) return observation.map.storages.filter((storage) => (observation.storageAcornCounts[storage.id] ?? 0) < gameBalance.acornsPerStorage)
      .map((storage) => ({ id: `return:${storage.id}`, position: storage.center, score: 100, action: 'ACORN' }));
    const goals: Goal[] = [];
    for (const opponent of observation.opponents.filter((player) => player.mode !== 'JAILED')) goals.push({
      id: `arrest:${opponent.id}`, position: opponent.position, score: opponent.heldAcornId ? 95 : 75, action: 'INTERACT'
    });
    for (const acorn of observation.acorns) if (acorn.location.kind === 'GROUND') goals.push({ id: `recover:${acorn.id}`, position: acorn.location.position, score: 80, action: 'ACORN' });
    for (const storage of observation.map.storages) goals.push({ id: `patrol:${storage.id}`, position: storage.center, score: 20 + (observation.storageAcornCounts[storage.id] ?? 0) * 2 });
    goals.push({ id: 'patrol:jail', position: this.jailApproach(observation), score: 18 });
    return goals;
  }

  protected nearestOpponent(observation: BotObservation) {
    return [...observation.opponents].sort((a, b) => distanceSquared(observation.self.position, a.position) - distanceSquared(observation.self.position, b.position))[0];
  }
  protected jailApproach(observation: BotObservation): Vec2 { return observation.map.jail.escapePoints[0] ?? observation.map.jail.center; }
  protected distanceTo(observation: BotObservation, position: Vec2): number { return Math.sqrt(distanceSquared(observation.self.position, position)); }
  protected inZone(observation: BotObservation, zone: ZoneDefinition): boolean { return this.distanceTo(observation, zone.center) <= zone.radius; }
}

export class RuleBasedPolicy extends TacticalPolicy {
  readonly kind = 'RULE_BASED' as const;
  /** 역할별 고정 우선순위 안에서 가까운 동률 목표를 선택한다. */
  chooseGoal(observation: BotObservation): Goal | null {
    const goals = this.goals(observation);
    const highest = Math.max(...goals.map((goal) => goal.score));
    const peers = goals.filter((goal) => goal.score === highest).sort((a, b) => a.id.localeCompare(b.id));
    if (peers.length > 1 && peers.every((goal) => goal.id.startsWith('steal:') || goal.id.startsWith('patrol:'))) {
      const hash = [...observation.self.id].reduce((value, character) => Math.imul(value ^ character.charCodeAt(0), 16777619), 2166136261) >>> 0;
      return peers[hash % peers.length] ?? null;
    }
    return peers.sort((a, b) => this.distanceTo(observation, a.position) - this.distanceTo(observation, b.position))[0] ?? null;
  }
}

export class GreedyPolicy extends TacticalPolicy {
  readonly kind = 'GREEDY' as const;
  private currentGoalId: string | null = null;
  private committedUntilMs = 0;

  /** 행동 보상에서 이동 비용·가시 위험·팀원 중복을 빼 매 시점의 효용이 가장 큰 목표를 선택한다. */
  chooseGoal(observation: BotObservation): Goal | null {
    const visibleThreats = observation.opponents.filter((player) => player.visible);
    const candidates = this.goals(observation).map((goal) => {
      const travelCost = this.distanceTo(observation, goal.position) * 0.35;
      const danger = teamOf(observation.self) === 'THIEF' ? visibleThreats.reduce((sum, opponent) => sum + Math.max(0, 18 - Math.sqrt(distanceSquared(goal.position, opponent.position))), 0) : 0;
      const teammateDuplication = observation.teammates.filter((player) => distanceSquared(player.position, goal.position) < 8 ** 2).length * 6;
      return { ...goal, utility: goal.score - travelCost - danger - teammateDuplication };
    }).sort((a, b) => b.utility - a.utility);
    const best = candidates[0];
    if (!best) { this.currentGoalId = null; return null; }
    const current = candidates.find((goal) => goal.id === this.currentGoalId);
    if (current && (observation.nowMs < this.committedUntilMs || current.utility >= best.utility - 4)) return current;
    this.currentGoalId = best.id;
    this.committedUntilMs = observation.nowMs + 1_000;
    return best;
  }
}

export function createBotPolicy(kind: BotPolicyKind): BotPolicy { return kind === 'GREEDY' ? new GreedyPolicy() : new RuleBasedPolicy(); }
