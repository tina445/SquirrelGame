import WebSocket from 'ws';
import { InputButton, envelope, fixedDeltaMs, protocolVersion, type ClientMessage, type ServerMessage } from '@squirrel-heist/shared';

const url = process.env.LOAD_WS_URL ?? 'ws://127.0.0.1:8080';
const botCount = Number(process.env.LOAD_BOTS ?? 80);
const durationMs = Number(process.env.LOAD_DURATION_MS ?? 30_000);
let connected = 0;
let snapshots = 0;
let errors = 0;

for (let index = 0; index < botCount; index += 1) {
  const socket = new WebSocket(url);
  let sequence = 0;
  let tick = 0;
  let timer: NodeJS.Timeout | null = null;
  socket.on('open', () => {
    connected += 1;
    socket.send(JSON.stringify(envelope('C2S_JOIN_ROOM', { displayName: `load-bot-${index}`, clientVersion: 'load-1' }) as ClientMessage));
    timer = setInterval(() => {
      const angle = tick / 25 + index;
      const buttons = tick % 80 === 0 ? InputButton.ACORN : tick % 120 === 0 ? InputButton.FIRE : 0;
      socket.send(JSON.stringify(envelope('C2S_INPUT', { sequence: sequence++, clientTick: tick++, moveX: Math.cos(angle), moveY: Math.sin(angle), aimX: Math.cos(angle), aimY: Math.sin(angle), buttons }) as ClientMessage));
    }, fixedDeltaMs);
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    if (message.protocolVersion !== protocolVersion) return;
    if (message.type === 'S2C_MAP_DEFINITION') socket.send(JSON.stringify(envelope('C2S_CLIENT_READY', { mapHash: message.payload.mapHash, assetsReady: true }) as ClientMessage));
    if (message.type === 'S2C_WORLD_SNAPSHOT') snapshots += 1;
    if (message.type === 'S2C_ERROR') errors += 1;
  });
  socket.on('error', () => { errors += 1; });
  setTimeout(() => { if (timer) clearInterval(timer); socket.close(); }, durationMs);
}

setTimeout(() => {
  console.log(JSON.stringify({ url, requestedBots: botCount, connected, snapshots, errors, durationMs }));
  process.exitCode = connected === botCount && errors === 0 ? 0 : 1;
}, durationMs + 1_000);
