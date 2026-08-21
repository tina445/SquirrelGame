import type { JoinRoomMode, PlayerId, PlayerSnapshot, RolePreference, Team, WorldSnapshot } from '@squirrel-heist/shared';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

export interface LobbyJoinRequest { mode: JoinRoomMode; displayName: string; rolePreference?: RolePreference; roomCode?: string }

/** 전체 월드 표현 목록에서 로컬과 같은 역할군만 경기 HUD용 데이터로 선택한다. */
export function teammatesFor(players: PlayerSnapshot[], localId: PlayerId): PlayerSnapshot[] {
  const local = players.find((player) => player.id === localId);
  return local ? local.team ? players.filter((player) => player.team === local.team) : players : [];
}

/** 친구 대기실의 최대 여덟 자리를 입장 순서대로 채우고 빈 슬롯도 유지한다. */
export function rosterSlots(players: PlayerSnapshot[], localId: PlayerId): Array<{ name: string; state: string; team: Team | null } | null> {
  const slots = players.map((player) => ({
    name: `${player.id === localId ? '나 · ' : ''}${player.displayName}`,
    state: player.ready ? '준비' : player.assetsReady ? '역할 선택 중' : '맵 준비 중',
    team: player.team
  }));
  return [...slots, ...Array.from({ length: Math.max(0, 8 - slots.length) }, () => null)].slice(0, 8);
}

export class Lobby {
  onJoin: (request: LobbyJoinRequest) => void = () => undefined;
  onLeave: () => void = () => undefined;
  onRolePreference: (role: Team) => void = () => undefined;
  onReady: (ready: boolean) => void = () => undefined;
  private connected = false;
  private joinedRoomId: string | null = null;
  private privateRoom = false;
  private selectedRole: Team | null = null;
  private localReady = false;

  /** 메인→매칭 역할 선택과 친구 Room→역할 선택→준비의 두 UI 상태 전이를 구성한다. */
  constructor() {
    element<HTMLInputElement>('display-name').value = localStorage.getItem('squirrel-heist-display-name') ?? '도토리 탐험가';
    element<HTMLButtonElement>('quick-start').addEventListener('click', () => this.showQuickRoles(true));
    element<HTMLButtonElement>('quick-role-back').addEventListener('click', () => this.showQuickRoles(false));
    element<HTMLButtonElement>('quick-police').addEventListener('click', () => this.submit('QUICK_MATCH', 'POLICE'));
    element<HTMLButtonElement>('quick-thief').addEventListener('click', () => this.submit('QUICK_MATCH', 'THIEF'));
    element<HTMLButtonElement>('quick-random').addEventListener('click', () => this.submit('QUICK_MATCH', 'RANDOM'));
    element<HTMLButtonElement>('create-room').addEventListener('click', () => this.submit('CREATE_ROOM'));
    element<HTMLButtonElement>('leave-room').addEventListener('click', () => {
      element<HTMLButtonElement>('leave-room').disabled = true;
      element('lobby-status').textContent = '메인으로 돌아가는 중…';
      this.onLeave();
    });
    element<HTMLFormElement>('join-room-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit('JOIN_ROOM');
    });
    for (const role of ['POLICE', 'THIEF'] as const) element<HTMLButtonElement>(`friend-${role.toLowerCase()}`).addEventListener('click', () => {
      this.localReady = false;
      element('lobby-status').textContent = '역할을 선택하는 중…';
      this.onRolePreference(role);
    });
    element<HTMLButtonElement>('friend-ready').addEventListener('click', () => {
      if (!this.selectedRole) return;
      this.onReady(!this.localReady);
      element<HTMLButtonElement>('friend-ready').disabled = true;
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

  joined(roomId: string, team: Team | null, listed: boolean, rolePreference: RolePreference | null): void {
    this.joinedRoomId = roomId;
    this.privateRoom = !listed;
    this.selectedRole = rolePreference === 'POLICE' || rolePreference === 'THIEF' ? rolePreference : null;
    this.localReady = false;
    this.setControlsEnabled(false);
    element('lobby-actions').hidden = true;
    element('quick-role-panel').hidden = true;
    element('room-panel').hidden = false;
    element('room-code').textContent = roomId;
    element('assigned-team').textContent = team ? this.teamLabel(team) : listed ? '선택 역할로 매칭 대기 중' : '역할을 선택해 주세요';
    element('friend-ready-controls').hidden = listed;
    element('lobby-status').textContent = listed ? '매칭 상대를 기다리는 중…' : '대기실에 입장했습니다. 역할을 선택하고 준비해 주세요.';
    this.updateFriendControls(false);
    element<HTMLButtonElement>('leave-room').disabled = false;
  }

  /** 서버 이탈 확인 후 Room 패널을 닫고 연결된 메인 참가 화면을 다시 활성화한다. */
  left(): void {
    this.joinedRoomId = null; this.privateRoom = false; this.selectedRole = null; this.localReady = false;
    element('room-panel').hidden = true;
    element('lobby-actions').hidden = false;
    this.showQuickRoles(false);
    element('lobby-error').hidden = true;
    element('lobby').hidden = false;
    element('hud').hidden = true;
    element('lobby-status').textContent = '참가 방법을 선택해 주세요.';
    this.setControlsEnabled(this.connected);
  }

  update(snapshot: WorldSnapshot, localId: PlayerId): void {
    const local = snapshot.players.find((player) => player.id === localId);
    if (!local) return;
    element('room-count').textContent = `${snapshot.players.length}/8명`;
    const roster = element('lobby-roster');
    roster.replaceChildren(...rosterSlots(snapshot.players, localId).map((slot) => {
      const card = document.createElement('div');
      card.className = `roster-slot${slot ? '' : ' empty'}${slot?.team ? ` ${slot.team.toLowerCase()}` : ''}`;
      const name = document.createElement('strong'); name.textContent = slot?.name ?? '빈 자리';
      const state = document.createElement('span'); state.textContent = slot ? (slot.team ? this.teamLabel(slot.team) : slot.state) : '대기 중';
      card.append(name, state);
      return card;
    }));
    this.localReady = local.ready;
    element('assigned-team').textContent = local.team ? this.teamLabel(local.team) : this.privateRoom ? this.selectedRole ? `${this.teamLabel(this.selectedRole)} 선택` : '역할을 선택해 주세요' : '선택 역할로 매칭 대기 중';
    if (this.privateRoom) this.updateFriendControls(local.assetsReady);
    this.setPhase(snapshot.phase);
  }

  /** 서버가 역할 예약 상한을 검증한 뒤에만 친구 Room의 선택 표시와 준비 버튼을 확정한다. */
  confirmRolePreference(role: Team): void {
    this.selectedRole = role;
    this.localReady = false;
    element('assigned-team').textContent = `${this.teamLabel(role)} 선택`;
    element('lobby-status').textContent = '역할을 선택했습니다. 준비 버튼을 눌러 주세요.';
    this.updateFriendControls(true);
  }

  setPhase(phase: WorldSnapshot['phase']): void {
    const playing = phase === 'PLAYING' || phase === 'FINISHED';
    element('lobby').hidden = playing;
    element('hud').hidden = !playing;
    if (phase === 'LOBBY') element('lobby-status').textContent = this.privateRoom ? '역할을 선택하고 준비해 주세요. 8명이 모두 준비하면 시작합니다.' : '매칭 상대를 기다리는 중입니다.';
    else if (phase === 'COUNTDOWN') element('lobby-status').textContent = '역할이 확정되었습니다. 곧 경기가 시작됩니다!';
  }

  showError(message: string): void {
    element('lobby-error').hidden = false;
    element('lobby-error').textContent = message;
    if (!this.joinedRoomId) {
      element('lobby-status').textContent = '다른 참가 방법을 선택해 주세요.';
      this.setControlsEnabled(this.connected);
    } else if (this.privateRoom) this.updateFriendControls(true);
  }

  private submit(mode: JoinRoomMode, rolePreference?: RolePreference): void {
    const displayName = element<HTMLInputElement>('display-name').value.trim();
    const roomCode = element<HTMLInputElement>('room-code-input').value.trim().toUpperCase();
    element('lobby-error').hidden = true;
    if (!displayName) { this.showError('닉네임을 입력해 주세요.'); return; }
    if (mode === 'JOIN_ROOM' && !/^[A-Z0-9]{4,8}$/.test(roomCode)) { this.showError('방 코드는 영문·숫자 4~8자리입니다.'); return; }
    localStorage.setItem('squirrel-heist-display-name', displayName);
    this.setControlsEnabled(false);
    element('lobby-status').textContent = mode === 'CREATE_ROOM' ? '친구 방을 만드는 중…' : mode === 'JOIN_ROOM' ? '친구 방에 참가하는 중…' : '매칭 대기열에 참가하는 중…';
    this.onJoin({ mode, displayName, ...(rolePreference ? { rolePreference } : {}), ...(mode === 'JOIN_ROOM' ? { roomCode } : {}) });
  }

  private showQuickRoles(show: boolean): void {
    element('entry-actions').hidden = show;
    element('quick-role-panel').hidden = !show;
  }

  private updateFriendControls(assetsReady: boolean): void {
    if (!this.privateRoom) return;
    for (const role of ['POLICE', 'THIEF'] as const) {
      const button = element<HTMLButtonElement>(`friend-${role.toLowerCase()}`);
      button.classList.toggle('selected', this.selectedRole === role);
      button.disabled = !assetsReady || this.localReady;
    }
    const ready = element<HTMLButtonElement>('friend-ready');
    ready.textContent = this.localReady ? '준비 취소' : '준비';
    ready.disabled = !assetsReady || !this.selectedRole;
  }

  private teamLabel(team: Team): string { return team === 'THIEF' ? '도둑 다람쥐' : '경찰 다람쥐'; }

  private setControlsEnabled(enabled: boolean): void {
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#lobby-actions input, #lobby-actions button')) control.disabled = !enabled;
  }
}
