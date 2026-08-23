import { createHealthServer, WebSocketGateway } from './gateway/webSocketGateway.js';
import { publicAccessPolicy } from './gateway/publicAccessPolicy.js';
import { RoomManager } from './room/roomManager.js';
import { FixedTickLoop } from './simulation/fixedTickLoop.js';
import { RoomBotCoordinator } from './bot/roomBotCoordinator.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const access = publicAccessPolicy();
const rooms = new RoomManager({ maxPlayers: access.maxPlayers });
const httpServer = createHealthServer(rooms, access.metricsToken);
const gateway = new WebSocketGateway(httpServer, rooms, access);
const optionalMilliseconds = (value: string | undefined): number | undefined => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const botFillDelayMs = optionalMilliseconds(process.env.MATCH_BOT_FILL_DELAY_MS);
const botFillIntervalMs = optionalMilliseconds(process.env.MATCH_BOT_FILL_INTERVAL_MS);
const bots = new RoomBotCoordinator({
  enabled: process.env.MATCH_BOTS_ENABLED !== 'false',
  ...(botFillDelayMs !== undefined ? { fillDelayMs: botFillDelayMs } : {}),
  ...(botFillIntervalMs !== undefined ? { fillIntervalMs: botFillIntervalMs } : {})
});
const tickLoop = new FixedTickLoop(
  () => rooms.rooms.values(),
  5,
  () => { rooms.cleanup(); bots.cleanup(rooms.rooms.values()); },
  (room) => bots.beforeTick(room)
);

httpServer.listen(port, host, () => {
  tickLoop.start();
  console.info(JSON.stringify({ level: 'info', event: 'server_started', host, port, staticDir: process.env.STATIC_DIR ?? null, maxPlayers: access.maxPlayers, botFillDelayMs, botFillIntervalMs }));
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
