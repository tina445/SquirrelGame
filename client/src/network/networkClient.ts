import { envelope, protocolVersion, type ClientMessage, type JoinRoomMode, type RolePreference, type ServerMessage } from '@squirrel-heist/shared';

type Listener = (message: ServerMessage) => void;

export class NetworkClient {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  readonly listeners = new Set<Listener>();
  onStatus: (status: string) => void = () => undefined;
  onReady: () => void = () => undefined;

  /** 환경에 맞는 ws/wss endpoint에 연결하고 token 기반 재접속 handshake를 시작한다. */
  connect(): void {
    const configured = import.meta.env.VITE_WS_URL as string | undefined;
    const url = configured ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`;
    this.onStatus('연결 중…');
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.onStatus('연결됨');
      const reconnectToken = sessionStorage.getItem('squirrel-heist-reconnect') ?? undefined;
      if (reconnectToken) {
        const displayName = localStorage.getItem('squirrel-heist-display-name') ?? '돌아온 다람쥐';
        this.send(envelope('C2S_JOIN_ROOM', { displayName, clientVersion: '0.3.0', reconnectToken }) as ClientMessage);
      } else this.onReady();
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.protocolVersion !== protocolVersion) return;
        if (message.type === 'S2C_JOINED_ROOM') sessionStorage.setItem('squirrel-heist-reconnect', message.payload.reconnectToken);
        for (const listener of this.listeners) listener(message);
      } catch { this.onStatus('잘못된 서버 응답'); }
    });
    this.socket.addEventListener('close', () => {
      if (this.closedByUser) return;
      this.onStatus('재접속 중…');
      const delay = Math.min(5_000, 500 * 2 ** this.reconnectAttempts++);
      setTimeout(() => this.connect(), delay);
    });
    this.socket.addEventListener('error', () => this.onStatus('연결 오류'));
  }

  /** 열린 transport에만 클라이언트 의도를 직렬화하며 로컬에서 권위 결과를 만들지 않는다. */
  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** 로비에서 확정한 사용자 의도만 join handshake로 보내며 팀 배정은 서버에 맡긴다. */
  join(mode: JoinRoomMode, displayName: string, rolePreference: RolePreference, roomCode?: string): void {
    this.send(envelope('C2S_JOIN_ROOM', { joinMode: mode, displayName, rolePreference, clientVersion: '0.3.0', ...(roomCode ? { roomCode } : {}) }) as ClientMessage);
  }

  /** 같은 transport를 유지한 채 경기 전 Room 이탈 의도를 서버에 보내 메인 로비로 복귀한다. */
  leaveRoom(): void { this.send(envelope('C2S_LEAVE_ROOM', {}) as ClientMessage); }

  /** 사용자 의도 종료를 표시해 close event가 자동 재접속을 예약하지 않게 한다. */
  close(): void { this.closedByUser = true; this.socket?.close(); }
}
