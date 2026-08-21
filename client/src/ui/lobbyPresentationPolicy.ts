import type { LobbyKind, MatchPhase } from '@squirrel-heist/shared';

export interface LobbyPresentationState {
  showMatchmaking: boolean;
  showRoster: boolean;
  showFriendControls: boolean;
  status: string;
}

export interface LobbyPresentationPolicy {
  readonly kind: LobbyKind;
  resolve(phase: MatchPhase, playerCount: number, allReady: boolean, isHost: boolean): LobbyPresentationState;
}

const quickMatchPresentation: LobbyPresentationPolicy = {
  kind: 'QUICK_MATCH',
  resolve: (phase, playerCount) => {
    const complete = playerCount >= 8 || phase === 'COUNTDOWN';
    return {
      showMatchmaking: !complete,
      showRoster: complete,
      showFriendControls: false,
      status: phase === 'COUNTDOWN' ? '매칭 완료! 참가자를 확인한 뒤 곧 경기를 시작합니다.' : `매칭 중… ${playerCount}/8명`
    };
  }
};

const friendRoomPresentation: LobbyPresentationPolicy = {
  kind: 'FRIEND_ROOM',
  resolve: (phase, _playerCount, allReady, isHost) => ({
    showMatchmaking: false,
    showRoster: true,
    showFriendControls: phase === 'LOBBY',
    status: phase === 'COUNTDOWN'
      ? '방장이 경기를 시작했습니다. 역할을 확정하고 있습니다!'
      : allReady
        ? isHost ? '모두 준비했습니다. 시작 버튼을 눌러 주세요.' : '모두 준비했습니다. 방장이 시작하기를 기다리는 중입니다.'
        : '역할을 선택하고 준비해 주세요.'
  })
};

/** 서버가 명시한 로비 종류에 따라 화면 전이 규칙을 선택해 UI 조건 분기를 격리한다. */
export function createLobbyPresentationPolicy(kind: LobbyKind): LobbyPresentationPolicy {
  return kind === 'QUICK_MATCH' ? quickMatchPresentation : friendRoomPresentation;
}
