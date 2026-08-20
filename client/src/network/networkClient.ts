import { envelope, protocolVersion, type ClientMessage, type ServerMessage } from '@squirrel-heist/shared';

type Listener = (message: ServerMessage) => void;

export class NetworkClient {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  readonly listeners = new Set<Listener>();
  onStatus: (status: string) => void = () => undefined;

  connect(): void {
    const configured = import.meta.env.VITE_WS_URL as string | undefined;
    const url = configured ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8080`;
    this.onStatus('연결 중…');
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.onStatus('연결됨');
      const reconnectToken = localStorage.getItem('squirrel-heist-reconnect') ?? undefined;
      const payload = { displayName: `다람쥐-${Math.floor(Math.random() * 900 + 100)}`, clientVersion: '0.1.0', ...(reconnectToken ? { reconnectToken } : {}) };
      this.send(envelope('C2S_JOIN_ROOM', payload) as ClientMessage);
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.protocolVersion !== protocolVersion) return;
        if (message.type === 'S2C_JOINED_ROOM') localStorage.setItem('squirrel-heist-reconnect', message.payload.reconnectToken);
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

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void { this.closedByUser = true; this.socket?.close(); }
}
