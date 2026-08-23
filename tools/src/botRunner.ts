import WebSocket from 'ws';
import { BotController, type BotPolicyKind } from '@squirrel-heist/bot-core';
import { envelope, protocolVersion, type ClientMessage, type MapDefinition, type PlayerId, type ServerMessage, type Team } from '@squirrel-heist/shared';

const url = process.env.BOT_WS_URL ?? 'ws://127.0.0.1:8080';
const count = Math.max(1, Number(process.env.BOT_COUNT ?? 1));
const requestedPolicy = (process.env.BOT_POLICY === 'GREEDY' ? 'GREEDY' : 'RULE_BASED') as BotPolicyKind;
const durationMs = Math.max(1_000, Number(process.env.BOT_DURATION_MS ?? 600_000));
let errors = 0;

for (let index = 0; index < count; index += 1) {
  const socket = new WebSocket(url);
  let map: MapDefinition | null = null;
  let playerId: PlayerId | null = null;
  let controller: BotController | null = null;
  let controllerTeam: Team | null = null;
  const name = `다람쥐${String((index * 7919 + 37) % 10_000).padStart(4, '0')}`;

  socket.on('open', () => socket.send(JSON.stringify(envelope('C2S_JOIN_ROOM', {
    joinMode: 'QUICK_MATCH', displayName: name, clientVersion: 'bot-runner-1', rolePreference: 'RANDOM'
  }) as ClientMessage)));
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.protocolVersion !== protocolVersion) return;
      if (message.type === 'S2C_JOINED_ROOM') playerId = message.payload.playerId as PlayerId;
      if (message.type === 'S2C_MAP_DEFINITION') {
        map = message.payload.map;
        socket.send(JSON.stringify(envelope('C2S_CLIENT_READY', { mapHash: map.hash, assetsReady: true }) as ClientMessage));
      }
      if (message.type === 'S2C_WORLD_SNAPSHOT' && map && playerId) {
        const self = message.payload.players.find((player) => player.id === playerId);
        if (!self?.team || message.payload.phase !== 'PLAYING') return;
        if (!controller || controllerTeam !== self.team) {
          controller = new BotController(requestedPolicy, `${message.roomId ?? 'room'}:${playerId}:${self.team}`, message.payload.serverTimeMs);
          controllerTeam = self.team;
        }
        socket.send(JSON.stringify(envelope('C2S_INPUT', controller.nextInput(map, message.payload, playerId), message.roomId) as ClientMessage));
      }
      if (message.type === 'S2C_ERROR') errors += 1;
    } catch { errors += 1; }
  });
  socket.on('error', () => { errors += 1; });
  setTimeout(() => socket.close(), durationMs);
}

setTimeout(() => {
  console.log(JSON.stringify({ url, count, policy: requestedPolicy, durationMs, errors }));
  process.exitCode = errors === 0 ? 0 : 1;
}, durationMs + 1_000);
