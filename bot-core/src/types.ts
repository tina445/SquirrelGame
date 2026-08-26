import type {
  AcornState, BerryState, InputCommand, MapDefinition, MatchPhase, PlayerId, PlayerSnapshot, Team, Vec2
} from '@squirrel-heist/shared';

export type BotPolicyKind = 'RULE_BASED' | 'GREEDY';

export interface ObservedOpponent extends PlayerSnapshot {
  observedAtMs: number;
  visible: boolean;
}

/** 미니맵의 운반 도토리 마커와 일치하는 공개 목표 위치다. */
export interface MinimapCarrier { playerId: PlayerId; position: Vec2 }

/** 자신의 람쥐썬더가 명중시킨 대상의 짧은 전술 기억이다. */
export interface RecentThunderHit { targetId: PlayerId; position: Vec2; expiresAtMs: number }

export interface BotObservation {
  map: MapDefinition;
  phase: MatchPhase;
  nowMs: number;
  remainingMs: number;
  self: PlayerSnapshot;
  teammates: PlayerSnapshot[];
  opponents: ObservedOpponent[];
  acorns: AcornState[];
  berries: BerryState[];
  /** 사람 미니맵에도 표시되는 공개 자원 정보다. 상대 위치·상태의 전역 공개에는 사용하지 않는다. */
  minimapAcorns: AcornState[];
  minimapBerries: BerryState[];
  minimapCarriers: MinimapCarrier[];
  recentThunderHit: RecentThunderHit | null;
  storageAcornCounts: Record<string, number>;
  thiefSecuredCount: number;
}

export interface BotDecision {
  goal: string;
  moveWorld: Vec2;
  aimWorld: Vec2;
  interact: boolean;
  acorn: boolean;
  fire: boolean;
}

export interface BotPolicy {
  readonly kind: BotPolicyKind;
  decide(observation: BotObservation): BotDecision;
}

export interface BotRuntimeAdapter {
  nextInput(map: MapDefinition, snapshot: import('@squirrel-heist/shared').WorldSnapshot, selfId: PlayerId): InputCommand;
  readonly policyKind: BotPolicyKind;
  readonly lastGoal: string;
  readonly decisionErrors: number;
}

export interface BotPolicySelection { POLICE: BotPolicyKind; THIEF: BotPolicyKind }
/** 기본 매칭은 역할 승률이 6:4 경계를 넘지 않은 rule-based 조합으로 유지한다. */
export const defaultBotPolicyByTeam: BotPolicySelection = { POLICE: 'RULE_BASED', THIEF: 'RULE_BASED' };

export const idleDecision = (goal = 'idle'): BotDecision => ({
  goal, moveWorld: { x: 0, y: 0 }, aimWorld: { x: 1, y: 0 }, interact: false, acorn: false, fire: false
});

export const teamOf = (player: PlayerSnapshot): Team => player.team ?? 'THIEF';
