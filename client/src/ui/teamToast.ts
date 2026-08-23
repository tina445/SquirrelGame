import { TeamNotificationKind, type GameEvent, type Team, type TeamNotificationKind as TeamNotificationKindValue } from '@squirrel-heist/shared';

const messages: Record<TeamNotificationKindValue, string> = {
  [TeamNotificationKind.THIEF_ARRESTED]: '도둑을 감옥에 가뒀습니다!',
  [TeamNotificationKind.ACORN_SECURED]: '도토리를 기지에 가져왔습니다!',
  [TeamNotificationKind.POLICE_ACORN_STOLEN]: '경찰 기지의 도토리를 도둑이 가져갔습니다!',
  [TeamNotificationKind.THIEF_ESCAPED]: '도둑이 감옥에서 탈출했습니다!'
};

function isTeamNotificationKind(value: unknown): value is TeamNotificationKindValue {
  return typeof value === 'string' && Object.values(TeamNotificationKind).includes(value as TeamNotificationKindValue);
}

/** 서버가 팀 전용으로 전달한 알림만 현재 확정 팀의 한국어 HUD 문구로 변환한다. */
export function teamToastMessage(event: GameEvent, localTeam: Team | null): string | null {
  if (event.type !== 'TEAM_NOTIFICATION' || localTeam === null || event.payload.recipientTeam !== localTeam) return null;
  return isTeamNotificationKind(event.payload.kind) ? messages[event.payload.kind] : null;
}

/** 상단 중앙의 짧은 전술 알림을 갱신하며 연속 이벤트는 최신 권위 결과로 교체한다. */
export class TeamToast {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly node: HTMLElement) {}

  show(event: GameEvent, localTeam: Team | null): void {
    const message = teamToastMessage(event, localTeam);
    if (!message) return;
    this.node.textContent = message;
    this.node.hidden = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.node.hidden = true; this.timer = null; }, 3_200);
  }
}
