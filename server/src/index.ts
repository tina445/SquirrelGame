import { createHealthServer, WebSocketGateway } from './gateway/webSocketGateway.js';
import { RoomManager } from './room/roomManager.js';
import { FixedTickLoop } from './simulation/fixedTickLoop.js';
import { publicAccessPolicy } from './gateway/publicAccessPolicy.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const access = publicAccessPolicy();
const rooms = new RoomManager({ maxPlayers: access.maxPlayers, botFillDelayMs: access.botFillDelayMs });
const httpServer = createHealthServer(rooms, access.metricsToken);
const gateway = new WebSocketGateway(httpServer, rooms, access);
const tickLoop = new FixedTickLoop(() => rooms.rooms.values(), 5, () => {
  rooms.fillQuickMatchBots();
  rooms.cleanup();
});

httpServer.listen(port, host, () => {
  tickLoop.start();
  console.info(JSON.stringify({ level: 'info', event: 'server_started', host, port, staticDir: process.env.STATIC_DIR ?? null, maxPlayers: access.maxPlayers, botFillDelayMs: access.botFillDelayMs }));
});

/** 새 연결과 tick을 중단한 뒤 HTTP listener가 닫히면 프로세스를 정상 종료한다. */
const shutdown = (): void => {
  tickLoop.stop();
  gateway.close();
  httpServer.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { rooms };
