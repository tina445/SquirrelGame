import { createHealthServer, WebSocketGateway } from './gateway/webSocketGateway.js';
import { RoomManager } from './room/roomManager.js';
import { FixedTickLoop } from './simulation/fixedTickLoop.js';

const port = Number(process.env.PORT ?? 8080);
const rooms = new RoomManager();
const httpServer = createHealthServer(rooms);
const gateway = new WebSocketGateway(httpServer, rooms);
const tickLoop = new FixedTickLoop(() => rooms.rooms.values());

httpServer.listen(port, '0.0.0.0', () => {
  tickLoop.start();
  console.info(JSON.stringify({ level: 'info', event: 'server_started', port }));
});

const shutdown = (): void => {
  tickLoop.stop();
  gateway.close();
  httpServer.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { rooms };
