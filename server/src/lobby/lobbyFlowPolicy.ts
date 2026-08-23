import { gameBalance, type LobbyKind, type PlayerState, type RolePreference } from '@squirrel-heist/shared';

export interface LobbyFlowPolicy {
  readonly kind: LobbyKind;
  readonly listed: boolean;
  readonly allowsRoleSelection: boolean;
  readonly allowsManualStart: boolean;
  canAcceptRole(players: PlayerState[], preference: RolePreference | null): boolean;
  applyAssetsReady(player: PlayerState): void;
  validateReady(players: PlayerState[], player: PlayerState, ready: boolean): string | null;
  shouldAutoStart(players: PlayerState[], requiredPlayers: number): boolean;
  canManualStart(players: PlayerState[], requiredPlayers: number): boolean;
}

const allConnectedAndReady = (players: PlayerState[], requiredPlayers: number): boolean =>
  players.length >= requiredPlayers && players.every((player) => player.ready && player.assetsReady &&
    (player.control === 'BOT' || player.connectionId !== null) && player.rolePreference !== null);

const quickMatchPolicy: LobbyFlowPolicy = {
  kind: 'QUICK_MATCH',
  listed: true,
  allowsRoleSelection: false,
  allowsManualStart: false,
  canAcceptRole: (players, preference) => preference === null || preference === 'RANDOM' || players.filter((player) => player.rolePreference === preference).length < gameBalance.teamSize,
  applyAssetsReady: (player) => { if (player.rolePreference !== null) player.ready = true; },
  validateReady: () => 'READY_REJECTED',
  shouldAutoStart: allConnectedAndReady,
  canManualStart: () => false
};

const friendRoomPolicy: LobbyFlowPolicy = {
  kind: 'FRIEND_ROOM',
  listed: false,
  allowsRoleSelection: true,
  allowsManualStart: true,
  canAcceptRole: (_players, preference) => preference === null,
  applyAssetsReady: () => undefined,
  validateReady: (players, player, ready) => {
    if (!player.assetsReady || player.rolePreference === null) return 'READY_REJECTED';
    if (!ready) return null;
    const readyInRole = players.filter((candidate) => candidate.id !== player.id && candidate.ready && candidate.rolePreference === player.rolePreference).length;
    return readyInRole >= gameBalance.teamSize ? 'ROLE_FULL' : null;
  },
  shouldAutoStart: () => false,
  canManualStart: (players, requiredPlayers) => {
    if (!allConnectedAndReady(players, requiredPlayers)) return false;
    if (requiredPlayers < gameBalance.teamSize * 2) return true;
    return players.filter((player) => player.rolePreference === 'POLICE').length === gameBalance.teamSize &&
      players.filter((player) => player.rolePreference === 'THIEF').length === gameBalance.teamSize;
  }
};

/** Room 종류에 맞는 역할·준비·시작 정책을 선택해 MatchRoom의 흐름 분기를 한 경계에 모은다. */
export function createLobbyFlowPolicy(kind: LobbyKind): LobbyFlowPolicy {
  return kind === 'QUICK_MATCH' ? quickMatchPolicy : friendRoomPolicy;
}
