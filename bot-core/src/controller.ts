import { InputButton, SeededRandom, gameBalance, normalize, type InputCommand, type MapDefinition, type PlayerId, type Vec2, type WorldSnapshot } from '@squirrel-heist/shared';
import { BotPerception } from './observation.js';
import { createBotPolicy } from './policies.js';
import { idleDecision, type BotDecision, type BotPolicyKind, type BotRuntimeAdapter } from './types.js';

export class BotController implements BotRuntimeAdapter {
  readonly policyKind: BotPolicyKind;
  lastGoal = 'idle';
  decisionErrors = 0;
  private readonly perception = new BotPerception();
  private readonly random: SeededRandom;
  private readonly policy;
  private sequence = 0;
  private nextDecisionAtMs = 0;
  private decision: BotDecision = idleDecision();

  constructor(kind: BotPolicyKind, seed: string, createdAtMs = 0) {
    this.policyKind = kind;
    this.policy = createBotPolicy(kind);
    this.random = new SeededRandom(seed);
    this.nextDecisionAtMs = createdAtMs + gameBalance.botDecisionIntervalMs + this.random.range(-50, 200);
  }

  /** 제한 관측과 seeded 반응 주기로 전략을 실행하고 사람 입력과 동일한 packet을 만든다. */
  nextInput(map: MapDefinition, snapshot: WorldSnapshot, selfId: PlayerId): InputCommand {
    const self = snapshot.players.find((player) => player.id === selfId);
    if (!self) throw new Error('BOT_SELF_NOT_FOUND');
    const observation = this.perception.observe(map, snapshot, selfId);
    if (snapshot.serverTimeMs >= this.nextDecisionAtMs) {
      try {
        const next = this.policy.decide(observation);
        this.decision = {
          ...next,
          aimWorld: this.jitter(next.aimWorld, 4, { x: 1, y: 0 }),
          moveWorld: this.jitter(next.moveWorld, 2, { x: 0, y: 0 })
        };
        this.lastGoal = this.decision.goal;
      } catch {
        this.decisionErrors += 1;
        this.decision = idleDecision('error');
      }
      this.nextDecisionAtMs = snapshot.serverTimeMs + gameBalance.botDecisionIntervalMs + this.random.range(-50, 200);
    }
    const aim = normalize(this.decision.aimWorld);
    const chargingThunder = self.mode === 'CHARGING' || (self.hasThunder && this.decision.fire);
    const move = chargingThunder ? { x: 0, y: 0 } : this.decision.moveWorld;
    const buttons = (this.decision.interact ? InputButton.INTERACT : 0) |
      (this.decision.acorn ? InputButton.ACORN : 0) | (this.decision.fire ? InputButton.FIRE : 0);
    return { sequence: this.sequence++, clientTick: snapshot.serverTick, moveX: move.x, moveY: move.y, aimX: aim.x, aimY: aim.y, buttons };
  }

  private jitter(value: Vec2, maximumDegrees: number, zeroFallback: Vec2): Vec2 {
    const base = normalize(value);
    if (base.x === 0 && base.y === 0) return zeroFallback;
    const angle = (this.random.range(-maximumDegrees, maximumDegrees) * Math.PI) / 180;
    return { x: base.x * Math.cos(angle) - base.y * Math.sin(angle), y: base.x * Math.sin(angle) + base.y * Math.cos(angle) };
  }
}
