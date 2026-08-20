import type { JoinRoomMode, PlayerId, PlayerSnapshot, RolePreference, Team, WorldSnapshot } from '@squirrel-heist/shared';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

export interface LobbyJoinRequest { mode: JoinRoomMode; displayName: string; rolePreference: RolePreference; roomCode?: string }

/** 전체 월드 표현 목록에서 로컬과 같은 역할군만 UI 명단 데이터로 선택한다. */
export function teammatesFor(players: PlayerSnapshot[], localId: PlayerId): PlayerSnapshot[] {
  const local = players.find((player) => player.id === localId);
  return local ? local.team ? players.filter((player) => player.team === local.team) : players : [];
}

export class Lobby {
  onJoin: (request: LobbyJoinRequest) => void = () => undefined;
  onLeave: () => void = () => undefined;
  private connected = false;
  private joinedRoomId: string | null = null;

  /** 로비 입력을 빠른 매칭·방 생성·코드 참가 의도로 변환하고 transport 준비 전 제출을 막는다. */
  constructor() {
    element<HTMLInputElement>('display-name').value = localStorage.getItem('squirrel-heist-display-name') ?? '도토리 탐험가';
    element<HTMLButtonElement>('quick-police').addEventListener('click', () => this.submit('QUICK_MATCH', 'POLICE'));
    element<HTMLButtonElement>('quick-thief').addEventListener('click', () => this.submit('QUICK_MATCH', 'THIEF'));
    element<HTMLButtonElement>('quick-match').addEventListener('click', () => this.submit('QUICK_MATCH', 'RANDOM'));
    element<HTMLButtonElement>('create-room').addEventListener('click', () => this.submit('CREATE_ROOM', this.friendRole()));
    element<HTMLButtonElement>('leave-room').addEventListener('click', () => {
      element<HTMLButtonElement>('leave-room').disabled = true;
      element('lobby-status').textContent = '메인으로 돌아가는 중…';
      this.onLeave();
    });
    element<HTMLFormElement>('join-room-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit('JOIN_ROOM', this.friendRole());
    });
  }

  setConnection(status: string, connected: boolean): void {
    this.connected = connected;
    element('lobby-connection').textContent = status;
    if (!this.joinedRoomId) {
      this.setControlsEnabled(connected);
      if (connected) element('lobby-status').textContent = '참가 방법을 선택해 주세요.';
    }
  }

  joined(roomId: string, team: Team | null): void {
    this.joinedRoomId = roomId;
    this.setControlsEnabled(false);
    element('lobby-actions').hidden = true;
    element('room-panel').hidden = false;
    element('room-code').textContent = roomId;
    element('assigned-team').textContent = team ? this.teamLabel(team) : '인원 확정 대기 중';
    element('lobby-status').textContent = '맵 준비 중…';
    element<HTMLButtonElement>('leave-room').disabled = false;
  }

  /** 서버 이탈 확인 후 Room 패널을 닫고 연결된 메인 참가 화면을 다시 활성화한다. */
  left(): void {
    this.joinedRoomId = null;
    element('room-panel').hidden = true;
    element('lobby-actions').hidden = false;
    element('lobby-error').hidden = true;
    element('lobby').hidden = false;
    element('hud').hidden = true;
    element('lobby-status').textContent = '참가 방법을 선택해 주세요.';
    this.setControlsEnabled(this.connected);
  }

  update(snapshot: WorldSnapshot, localId: PlayerId): void {
    const local = snapshot.players.find((player) => player.id === localId);
    if (!local) return;
    const teammates = teammatesFor(snapshot.players, localId);
    element('room-count').textContent = `${snapshot.players.length}/8명`;
    element('lobby-roster').textContent = teammates.map((player) => `${player.id === localId ? '나 · ' : ''}${player.displayName}`).join(' / ');
    element('roster-label').textContent = local.team ? '내 팀' : '참가자';
    element('assigned-team').textContent = local.team ? this.teamLabel(local.team) : '인원 확정 대기 중';
    this.setPhase(snapshot.phase);
  }

  setPhase(phase: WorldSnapshot['phase']): void {
    const playing = phase === 'PLAYING' || phase === 'FINISHED';
    element('lobby').hidden = playing;
    element('hud').hidden = !playing;
    if (phase === 'LOBBY') element('lobby-status').textContent = '다른 플레이어를 기다리는 중입니다.';
    else if (phase === 'COUNTDOWN') element('lobby-status').textContent = '곧 경기가 시작됩니다!';
  }

  showError(message: string): void {
    element('lobby-error').hidden = false;
    element('lobby-error').textContent = message;
    if (!this.joinedRoomId) {
      element('lobby-status').textContent = '다른 참가 방법을 선택해 주세요.';
      this.setControlsEnabled(this.connected);
    }
  }

  private submit(mode: JoinRoomMode, rolePreference: RolePreference): void {
    const displayName = element<HTMLInputElement>('display-name').value.trim();
    const roomCode = element<HTMLInputElement>('room-code-input').value.trim().toUpperCase();
    element('lobby-error').hidden = true;
    if (!displayName) { this.showError('닉네임을 입력해 주세요.'); return; }
    if (mode === 'JOIN_ROOM' && !/^[A-Z0-9]{4,8}$/.test(roomCode)) { this.showError('방 코드는 영문·숫자 4~8자리입니다.'); return; }
    localStorage.setItem('squirrel-heist-display-name', displayName);
    this.setControlsEnabled(false);
    element('lobby-status').textContent = mode === 'CREATE_ROOM' ? '방을 만드는 중…' : mode === 'JOIN_ROOM' ? '방에 참가하는 중…' : '매칭 중…';
    this.onJoin({ mode, displayName, rolePreference, ...(mode === 'JOIN_ROOM' ? { roomCode } : {}) });
  }

  private friendRole(): Team { return element<HTMLSelectElement>('friend-role').value as Team; }
  private teamLabel(team: Team): string { return team === 'THIEF' ? '도둑 다람쥐' : '경찰 다람쥐'; }

  private setControlsEnabled(enabled: boolean): void {
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('#lobby-actions input, #lobby-actions button, #lobby-actions select')) control.disabled = !enabled;
  }
}
