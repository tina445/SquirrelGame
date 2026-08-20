import './style.css';
import {
  envelope, fixedDeltaMs, gameBalance, verifyMapHash,
  type ClientMessage, type MapDefinition, type PlayerId, type ServerMessage, type Team, type WorldSnapshot
} from '@squirrel-heist/shared';
import { EventAudio } from './audio/eventAudio.js';
import { InputSampler } from './input/inputSampler.js';
import { NetworkClient } from './network/networkClient.js';
import { LocalPrediction } from './prediction/localPrediction.js';
import { SnapshotBuffer } from './prediction/snapshotBuffer.js';
import { ThreeRenderer } from './rendering/threeRenderer.js';
import { Hud } from './ui/hud.js';

const game = document.querySelector<HTMLElement>('#game')!;
const renderer = new ThreeRenderer(game);
const input = new InputSampler(game);
const network = new NetworkClient();
const prediction = new LocalPrediction();
const snapshots = new SnapshotBuffer();
const hud = new Hud();
const audio = new EventAudio();
let map: MapDefinition | null = null;
let latest: WorldSnapshot | null = null;
let localId: PlayerId | null = null;
let localTeam: Team | null = null;
let sequence = 0;
let clientTick = 0;

network.onStatus = (status) => hud.setConnection(status);
network.listeners.add((message) => handleMessage(message));
network.connect();

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'S2C_JOINED_ROOM':
      localId = message.payload.playerId as PlayerId;
      localTeam = message.payload.team;
      renderer.setLocalPlayer(localId);
      break;
    case 'S2C_MAP_DEFINITION':
      if (!verifyMapHash(message.payload.map)) { hud.showError('맵 해시가 일치하지 않습니다. 전체 상태를 다시 요청합니다.'); network.send(envelope('C2S_REQUEST_RESYNC', {}) as ClientMessage); return; }
      map = message.payload.map;
      renderer.buildMap(map);
      network.send(envelope('C2S_CLIENT_READY', { mapHash: map.hash, assetsReady: true }) as ClientMessage);
      break;
    case 'S2C_WORLD_SNAPSHOT':
      acceptSnapshot(message.payload);
      break;
    case 'S2C_FULL_STATE':
      if (!verifyMapHash(message.payload.map)) { hud.showError('재동기화된 맵 해시가 올바르지 않습니다.'); return; }
      map = message.payload.map;
      renderer.buildMap(map);
      acceptSnapshot(message.payload.snapshot);
      break;
    case 'S2C_GAME_EVENTS':
      for (const event of message.payload.events) audio.play(event.type);
      break;
    case 'S2C_MATCH_PHASE':
      if (message.payload.phase === 'FINISHED' && message.payload.winner && localTeam) hud.result(message.payload.winner, message.payload.reason ?? '', localTeam);
      break;
    case 'S2C_ERROR':
      if (message.payload.code === 'RECONNECT_EXPIRED') { localStorage.removeItem('squirrel-heist-reconnect'); location.reload(); }
      else hud.showError(`서버 오류: ${message.payload.code}`);
      break;
    default:
      break;
  }
}

function acceptSnapshot(snapshot: WorldSnapshot): void {
  latest = snapshot;
  snapshots.push(snapshot);
  if (!localId || !map) return;
  const local = snapshot.players.find((player) => player.id === localId);
  if (!local) return;
  if (prediction.position.x === 0 && prediction.position.y === 0) prediction.configure(map, local.position);
  else prediction.reconcile(local);
  hud.update(snapshot, map, localId);
}

setInterval(() => {
  if (!localId) return;
  const command = input.sample(sequence++, clientTick++);
  network.send(envelope('C2S_INPUT', command) as ClientMessage);
  const local = latest?.players.find((player) => player.id === localId);
  if (latest?.phase === 'PLAYING' && local?.mode === 'NORMAL') prediction.apply(command, fixedDeltaMs / 1_000, local.heldAcornId !== null);
}, fixedDeltaMs);

function frame(): void {
  requestAnimationFrame(frame);
  if (latest) {
    const target = latest.serverTimeMs - gameBalance.interpolationDelayMs;
    renderer.update(latest, localId ? prediction.position : null, (id) => snapshots.interpolate(id, target));
  }
  renderer.render();
}
frame();
