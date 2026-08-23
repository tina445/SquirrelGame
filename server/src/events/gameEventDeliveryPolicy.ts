import type { GameEvent, Team } from '@squirrel-heist/shared';

/** 권위 event의 네트워크 가시 범위를 전체 또는 확정 팀 단위로 명시한다. */
export type GameEventAudience = { kind: 'ALL' } | { kind: 'TEAM'; team: Team };

/** event 본문과 수신 범위를 함께 보관해 시뮬레이션 결과와 전송 정책을 분리한다. */
export interface RoutedGameEvent { event: GameEvent; audience: GameEventAudience }

/** Room이 관전자·개인·팀 등 후속 수신 범위를 정책 교체로 확장할 수 있는 전달 경계다. */
export interface GameEventDeliveryPolicy {
  canDeliver(routed: RoutedGameEvent, recipientTeam: Team | null): boolean;
}

/** 기본 정책은 보통 게임 event를 공개하고, 팀 전술 event만 확정 팀에 한정한다. */
export class DefaultGameEventDeliveryPolicy implements GameEventDeliveryPolicy {
  canDeliver(routed: RoutedGameEvent, recipientTeam: Team | null): boolean {
    return routed.audience.kind === 'ALL' || routed.audience.team === recipientTeam;
  }
}
