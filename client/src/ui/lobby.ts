import type { JoinRoomMode, LobbyKind, PlayerId, PlayerSnapshot, RolePreference, Team, WorldSnapshot } from '@squirrel-heist/shared';
import { createLobbyPresentationPolicy, type LobbyPresentationPolicy } from './lobbyPresentationPolicy.js';
import { saveSessionDisplayName, sessionDisplayName } from './guestName.js';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

export interface LobbyJoinRequest { mode: JoinRoomMode; displayName: string; rolePreference?: RolePreference; roomCode?: string }
export interface RosterSlot {
  id: PlayerId;
  name: string;
  state: string;
  team: Team | null;
  rolePreference: RolePreference | null;
  ready: boolean;
  isHost: boolean;
}

/** 공개 테스트 입장 보호 오류를 사용자가 바로 복구할 수 있는 한국어 안내로 바꾼다. */
export function publicAdmissionError(code: string): string | null {
  if (code === 'SERVER_FULL') return '공개 테스트 정원(24명)이 모두 찼습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'JOIN_RATE_LIMITED') return '입장 시도가 너무 많습니다. 1분 후 다시 시도해 주세요.';
  return null;
}

/** 전체 월드 표현 목록에서 로컬과 같은 역할군만 경기 HUD용 데이터로 선택한다. */
export function teammatesFor(players: PlayerSnapshot[], localId: PlayerId): PlayerSnapshot[] {
  const local = players.find((player) => player.id === localId);
  return local ? local.team ? players.filter((player) => player.team === local.team) : players : [];
}

/** 대기실의 최대 여덟 자리를 입장 순서대로 채우고 역할 선택·준비·방장 상태를 보존한다. */
export function rosterSlots(players: PlayerSnapshot[], localId: PlayerId, hostPlayerId: PlayerId | null = null): Array<RosterSlot | null> {
  const slots = players.map((player) => ({
    id: player.id,
    name: `${player.id === localId ? '나 · ' : ''}${player.displayName}${player.id === hostPlayerId ? ' · 방장' : ''}`,
    state: player.ready ? '준비' : player.assetsReady ? player.rolePreference ? '선택 중' : '역할 선택 중' : '맵 준비 중',
    team: player.team,
    rolePreference: player.rolePreference,
    ready: player.ready,
    isHost: player.id === hostPlayerId
  }));
  return [...slots, ...Array.from({ length: Math.max(0, 8 - slots.length) }, () => null)].slice(0, 8);
}

/** 친구 Room 시작 버튼을 위한 전원 준비·연결·정확한 역할 4:4 조건을 snapshot에서 계산한다. */
export function canStartFriendMatch(players: PlayerSnapshot[]): boolean {
  if (players.length !== 8 || players.some((player) => !player.ready || !player.assetsReady || player.disconnectedAtMs !== null || player.rolePreference === null)) return false;
  return players.filter((player) => player.rolePreference === 'POLICE').length === 4 && players.filter((player) => player.rolePreference === 'THIEF').length === 4;
}

export class Lobby {
  onJoin: (request: LobbyJoinRequest) => void = () => undefined;
  onLeave: () => void = () => undefined;
  onRolePreference: (role: Team) => void = () => undefined;
  onReady: (ready: boolean) => void = () => undefined;
  onStartMatch: () => void = () => undefined;
  onTransferHost: (targetPlayerId: PlayerId) => void = () => undefined;
  private connected = false;
  private joinedRoomId: string | null = null;
  private lobbyKind: LobbyKind | null = null;
  private presentation: LobbyPresentationPolicy | null = null;
  private selectedRole: Team | null = null;
  private localReady = false;
  private localPlayerId: PlayerId | null = null;
  private hostPlayerId: PlayerId | null = null;
  private selectedHostTarget: PlayerId | null = null;
  private rosterSignature = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** 메인→역할 선택, 빠른 매칭 진행, 친구 Room 역할·준비·방장 흐름의 UI 이벤트를 구성한다. */
  constructor() {
    element<HTMLInputElement>('display-name').value = sessionDisplayName();
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
    element<HTMLButtonElement>('friend-start').addEventListener('click', () => {
      element<HTMLButtonElement>('friend-start').disabled = true;
      element('lobby-status').textContent = '게임 시작을 요청하는 중…';
      this.onStartMatch();
    });
    element<HTMLButtonElement>('transfer-host').addEventListener('click', () => {
      if (!this.selectedHostTarget) return;
      element<HTMLButtonElement>('transfer-host').disabled = true;
      element('lobby-status').textContent = '방장을 변경하는 중…';
      this.onTransferHost(this.selectedHostTarget);
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

  /** 서버가 명시한 LobbyKind의 표시 정책을 선택하고 Room 진입 초기 화면을 구성한다. */
  joined(roomId: string, team: Team | null, lobbyKind: LobbyKind, rolePreference: RolePreference | null, localPlayerId: PlayerId, hostPlayerId: PlayerId | null): void {
    this.joinedRoomId = roomId;
    this.lobbyKind = lobbyKind;
    this.presentation = createLobbyPresentationPolicy(lobbyKind);
    this.localPlayerId = localPlayerId;
    this.hostPlayerId = hostPlayerId;
    this.selectedRole = rolePreference === 'POLICE' || rolePreference === 'THIEF' ? rolePreference : null;
    this.localReady = false;
    this.selectedHostTarget = null;
    this.rosterSignature = '';
    this.setControlsEnabled(false);
    element('lobby-actions').hidden = true;
    element('quick-role-panel').hidden = true;
    element('room-panel').hidden = false;
    element('room-code').textContent = roomId;
    element('assigned-team').textContent = team ? this.teamLabel(team) : lobbyKind === 'QUICK_MATCH' ? '매칭 완료 후 확정' : '역할을 선택해 주세요';
    element('matchmaking-wait').hidden = lobbyKind !== 'QUICK_MATCH';
    element('room-roster-content').hidden = lobbyKind === 'QUICK_MATCH';
    element('friend-ready-controls').hidden = lobbyKind !== 'FRIEND_ROOM';
    element('friend-host-controls').hidden = lobbyKind !== 'FRIEND_ROOM';
    element('lobby-status').textContent = lobbyKind === 'QUICK_MATCH' ? '매칭 중… 1/8명' : '대기실에 입장했습니다. 역할을 선택하고 준비해 주세요.';
    this.updateFriendControls(false);
    element<HTMLButtonElement>('leave-room').disabled = false;
  }

  /** 서버 이탈 확인 후 Room 패널과 선택 상태를 비우고 메인 참가 화면을 복원한다. */
  left(): void {
    this.joinedRoomId = null; this.lobbyKind = null; this.presentation = null; this.selectedRole = null; this.localReady = false;
    this.localPlayerId = null; this.hostPlayerId = null; this.selectedHostTarget = null;
    this.rosterSignature = '';
    element('room-panel').hidden = true;
    element('lobby-actions').hidden = false;
    this.showQuickRoles(false);
    element('lobby-error').hidden = true;
    element('lobby').hidden = false;
    element('hud').hidden = true;
    element('lobby-status').textContent = '참가 방법을 선택해 주세요.';
    this.setControlsEnabled(this.connected);
  }

  /** snapshot을 선택된 표시 Strategy에 투영하고 4×2 프로필·방장 제어·준비 상태를 갱신한다. */
  update(snapshot: WorldSnapshot, localId: PlayerId): void {
    const local = snapshot.players.find((player) => player.id === localId);
    if (!local || !this.presentation) return;
    this.localPlayerId = localId;
    this.hostPlayerId = snapshot.hostPlayerId;
    if (this.selectedHostTarget && !snapshot.players.some((player) => player.id === this.selectedHostTarget)) this.selectedHostTarget = null;
    if (this.hostPlayerId !== localId) this.selectedHostTarget = null;
    const isHost = this.hostPlayerId === localId;
    const canStart = canStartFriendMatch(snapshot.players);
    const view = this.presentation.resolve(snapshot.phase, snapshot.players.length, canStart, isHost);
    element('room-count').textContent = `${snapshot.players.length}/8명`;
    element('matchmaking-wait').hidden = !view.showMatchmaking;
    element('room-roster-content').hidden = !view.showRoster;
    element('friend-ready-controls').hidden = !view.showFriendControls;
    element('friend-host-controls').hidden = this.lobbyKind !== 'FRIEND_ROOM' || snapshot.phase !== 'LOBBY';
    this.renderRoster(snapshot.players, localId, isHost);
    this.localReady = local.ready;
    this.selectedRole = local.rolePreference === 'POLICE' || local.rolePreference === 'THIEF' ? local.rolePreference : this.selectedRole;
    element('assigned-team').textContent = local.team ? this.teamLabel(local.team) : this.lobbyKind === 'FRIEND_ROOM' ? this.selectedRole ? `${this.teamLabel(this.selectedRole)} ${this.localReady ? '· 준비' : '선택 중'}` : '역할을 선택해 주세요' : '매칭 완료 후 확정';
    if (this.lobbyKind === 'FRIEND_ROOM') {
      this.updateFriendControls(local.assetsReady);
      const start = element<HTMLButtonElement>('friend-start');
      start.textContent = isHost ? '게임 시작' : '방장이 시작하기를 기다리는 중';
      start.disabled = !isHost || !canStart;
      const transfer = element<HTMLButtonElement>('transfer-host');
      transfer.hidden = !isHost;
      transfer.disabled = !isHost || this.selectedHostTarget === null;
    }
    element('lobby-status').textContent = view.status;
    this.setPhase(snapshot.phase);
  }

  /** 서버 확인 뒤 로컬 역할 선택을 표시하며 실제 팀은 시작 직전까지 확정하지 않는다. */
  confirmRolePreference(role: Team): void {
    this.selectedRole = role;
    this.localReady = false;
    element('assigned-team').textContent = `${this.teamLabel(role)} 선택 중`;
    element('lobby-status').textContent = '역할을 선택했습니다. 준비 버튼을 눌러 주세요.';
    this.updateFriendControls(true);
  }

  setPhase(phase: WorldSnapshot['phase']): void {
    const playing = phase === 'PLAYING' || phase === 'FINISHED';
    element('lobby').hidden = playing;
    element('hud').hidden = !playing;
    if (phase === 'COUNTDOWN' && this.lobbyKind === 'QUICK_MATCH') element('lobby-status').textContent = '매칭 완료! 참가자를 확인한 뒤 곧 경기를 시작합니다.';
  }

  /** 역할 준비 정원이 찼을 때 modal 오류 대신 즉시 이해 가능한 toast를 표시하고 준비 제어를 복구한다. */
  showRoleCapacityToast(): void {
    this.localReady = false;
    this.showToast('선택한 역할은 이미 4명이 준비했습니다. 다른 역할을 선택해 주세요.');
    this.updateFriendControls(true);
  }

  showError(message: string): void {
    element('lobby-error').hidden = false;
    element('lobby-error').textContent = message;
    if (!this.joinedRoomId) {
      element('lobby-status').textContent = '다른 참가 방법을 선택해 주세요.';
      this.setControlsEnabled(this.connected);
    } else if (this.lobbyKind === 'FRIEND_ROOM') this.updateFriendControls(true);
  }

  private renderRoster(players: PlayerSnapshot[], localId: PlayerId, isHost: boolean): void {
    const signature = JSON.stringify({
      players: players.map((player) => [player.id, player.displayName, player.team, player.rolePreference, player.ready, player.assetsReady]),
      localId,
      hostPlayerId: this.hostPlayerId,
      selectedHostTarget: this.selectedHostTarget,
      isHost
    });
    if (signature === this.rosterSignature) return;
    this.rosterSignature = signature;
    const roster = element('lobby-roster');
    roster.replaceChildren(...rosterSlots(players, localId, this.hostPlayerId).map((slot) => {
      const selectable = Boolean(slot && isHost && slot.id !== localId);
      const card = document.createElement(selectable ? 'button' : 'div');
      if (card instanceof HTMLButtonElement) card.type = 'button';
      card.className = `roster-slot${slot ? '' : ' empty'}${slot?.team ? ` ${slot.team.toLowerCase()}` : ''}${slot?.id === this.selectedHostTarget ? ' host-target' : ''}`;
      if (slot && selectable) card.addEventListener('click', () => {
        this.selectedHostTarget = this.selectedHostTarget === slot.id ? null : slot.id;
        this.renderRoster(players, localId, isHost);
        element<HTMLButtonElement>('transfer-host').disabled = this.selectedHostTarget === null;
      });
      const name = document.createElement('strong'); name.textContent = slot?.name ?? '빈 자리';
      const state = document.createElement('span');
      const selectedTeam = slot?.team ?? (slot?.rolePreference === 'POLICE' || slot?.rolePreference === 'THIEF' ? slot.rolePreference : null);
      state.textContent = slot ? selectedTeam ? `${this.teamLabel(selectedTeam)} · ${slot.ready ? '준비' : '선택 중'}` : slot.state : '대기 중';
      card.append(name, state);
      return card;
    }));
  }

  private submit(mode: JoinRoomMode, rolePreference?: RolePreference): void {
    const displayName = element<HTMLInputElement>('display-name').value.trim();
    const roomCode = element<HTMLInputElement>('room-code-input').value.trim().toUpperCase();
    element('lobby-error').hidden = true;
    if (!displayName) { this.showError('닉네임을 입력해 주세요.'); return; }
    if (mode === 'JOIN_ROOM' && !/^[A-Z0-9]{4,8}$/.test(roomCode)) { this.showError('방 코드는 영문·숫자 4~8자리입니다.'); return; }
    saveSessionDisplayName(displayName);
    this.setControlsEnabled(false);
    element('lobby-status').textContent = mode === 'CREATE_ROOM' ? '친구 방을 만드는 중…' : mode === 'JOIN_ROOM' ? '친구 방에 참가하는 중…' : '매칭 대기열에 참가하는 중…';
    this.onJoin({ mode, displayName, ...(rolePreference ? { rolePreference } : {}), ...(mode === 'JOIN_ROOM' ? { roomCode } : {}) });
  }

  private showQuickRoles(show: boolean): void {
    element('entry-actions').hidden = show;
    element('quick-role-panel').hidden = !show;
  }

  private updateFriendControls(assetsReady: boolean): void {
    if (this.lobbyKind !== 'FRIEND_ROOM') return;
    for (const role of ['POLICE', 'THIEF'] as const) {
      const button = element<HTMLButtonElement>(`friend-${role.toLowerCase()}`);
      button.classList.toggle('selected', this.selectedRole === role);
      button.disabled = !assetsReady || this.localReady;
    }
    const ready = element<HTMLButtonElement>('friend-ready');
    ready.textContent = this.localReady ? '준비 취소' : '준비';
    ready.disabled = !assetsReady || !this.selectedRole;
  }

  private showToast(message: string): void {
    const toast = element('lobby-toast');
    toast.textContent = message;
    toast.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { toast.hidden = true; this.toastTimer = null; }, 3_200);
  }

  private teamLabel(team: Team): string { return team === 'THIEF' ? '도둑 다람쥐' : '경찰 다람쥐'; }

  private setControlsEnabled(enabled: boolean): void {
    for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#lobby-actions input, #lobby-actions button')) control.disabled = !enabled;
  }
}
