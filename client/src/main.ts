import './style.css';
import {
  envelope, fixedDeltaMs, gameBalance, normalize, subtract, verifyMapHash,
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
const seenEventIds = new Set<string>();

/** 포인터의 지면 좌표와 로컬 예측 위치로 방향을 계산해 표현과 다음 입력 패킷에 공유한다. */
function updateAimFromPointer(): void {
  const pointer = input.getPointerClientPosition();
  if (!pointer || !localId || !latest) return;
  const local = latest.players.find((player) => player.id === localId);
  const target = renderer.clientToGame(pointer.x, pointer.y);
  if (!local || !target) return;
  input.updateAim(normalize(subtract(target, prediction.position)));
}

network.onStatus = (status) => hud.setConnection(status);
network.listeners.add((message) => handleMessage(message));
network.connect();

/** 서버 메시지를 맵·snapshot·event·phase adapter로 분배하고 권위 결과만 UI에 확정한다. */
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
      for (const event of message.payload.events) {
        if (seenEventIds.has(event.eventId)) continue;
        seenEventIds.add(event.eventId);
        audio.play(event.type);
      }
      if (seenEventIds.size > 2_000) seenEventIds.clear();
      break;
    case 'S2C_MATCH_PHASE':
      if (message.payload.phase === 'FINISHED' && message.payload.winner && localTeam) hud.result(message.payload.winner, message.payload.reason ?? '', localTeam);
      break;
    case 'S2C_ERROR':
      if (message.payload.code === 'RECONNECT_EXPIRED') { sessionStorage.removeItem('squirrel-heist-reconnect'); location.reload(); }
      else if (message.payload.code === 'ROOM_SIMULATION_FAILED') {
        sessionStorage.removeItem('squirrel-heist-reconnect');
        network.close();
        hud.showError('Room 오류로 경기가 안전하게 종료되었습니다. 새 경기에 참가하려면 페이지를 새로고침하세요.');
      }
      else hud.showError(`서버 오류: ${message.payload.code}`);
      break;
    default:
      break;
  }
}

/** snapshot을 보간 buffer에 넣고 로컬 ack 기준 reconciliation과 HUD 갱신을 수행한다. */
function acceptSnapshot(snapshot: WorldSnapshot): void {
  latest = snapshot;
  snapshots.push(snapshot);
  if (!localId || !map) return;
  const local = snapshot.players.find((player) => player.id === localId);
  if (!local) return;
  if (!prediction.isConfigured) prediction.configure(map, local.position);
  else prediction.reconcile(local);
  hud.update(snapshot, map, localId);
}

setInterval(() => {
  if (!localId) return;
  updateAimFromPointer();
  const command = input.sample(sequence++, clientTick++);
  network.send(envelope('C2S_INPUT', command) as ClientMessage);
  const local = latest?.players.find((player) => player.id === localId);
  if (latest?.phase === 'PLAYING' && local?.mode === 'NORMAL') prediction.apply(command, fixedDeltaMs / 1_000, local.heldAcornId !== null);
}, fixedDeltaMs);

/** 서버 tick과 독립된 frame에서 조준 예측, snapshot 표현 합성, WebGL 렌더를 수행한다. */
function frame(): void {
  requestAnimationFrame(frame);
  if (latest) {
    updateAimFromPointer();
    const target = latest.serverTimeMs - gameBalance.interpolationDelayMs;
    renderer.update(latest, localId ? prediction.position : null, localId ? input.getAim() : null, (id) => snapshots.interpolate(id, target));
  }
  renderer.render();
}
frame();
