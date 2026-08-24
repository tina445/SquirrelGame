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
import { Lobby, publicAdmissionError } from './ui/lobby.js';

const game = document.querySelector<HTMLElement>('#game')!;
const renderer = new ThreeRenderer(game);
const spriteAssetsReady = renderer.prepareAssets();
const input = new InputSampler(game);
const network = new NetworkClient();
const prediction = new LocalPrediction();
const snapshots = new SnapshotBuffer();
const hud = new Hud();
const lobby = new Lobby();
const audio = new EventAudio();
let map: MapDefinition | null = null;
let renderedMapHash: string | null = null;
let latest: WorldSnapshot | null = null;
let localId: PlayerId | null = null;
let localTeam: Team | null = null;
let sequence = 0;
let clientTick = 0;
let lastFrameMs = performance.now();
const seenEventIds = new Set<string>();

/** 포인터의 지면 좌표와 로컬 예측 위치로 방향을 계산해 표현과 다음 입력 패킷에 공유한다. */
function updateAimFromPointer(): void {
  const pointer = input.getPointerClientPosition();
  if (!pointer || !localId || !latest) return;
  const local = latest.players.find((player) => player.id === localId);
  const target = renderer.clientToGame(pointer.x, pointer.y);
  if (!local || !target) return;
  input.updateAim(normalize(subtract(target, prediction.visualPosition)));
}

network.onStatus = (status) => {
  hud.setConnection(status);
  lobby.setConnection(status, false);
};
network.onReady = () => lobby.setConnection('서버 연결 완료', true);
network.listeners.add((message) => handleMessage(message));
lobby.onJoin = ({ mode, displayName, rolePreference, roomCode }) => network.join(mode, displayName, rolePreference, roomCode);
lobby.onLeave = () => network.leaveRoom();
lobby.onRolePreference = (rolePreference) => network.send(envelope('C2S_SET_ROLE_PREFERENCE', { rolePreference }) as ClientMessage);
lobby.onReady = (ready) => network.send(envelope('C2S_SET_READY', { ready }) as ClientMessage);
lobby.onStartMatch = () => network.send(envelope('C2S_START_MATCH', {}) as ClientMessage);
lobby.onTransferHost = (targetPlayerId) => network.send(envelope('C2S_TRANSFER_HOST', { targetPlayerId }) as ClientMessage);
hud.onChat = (text) => network.send(envelope('C2S_CHAT', { text }) as ClientMessage);
network.connect();

/** 로비·카운트다운에서는 맵을 만들거나 그리지 않고, 실제 경기 상태에서만 월드 표현을 활성화한다. */
function syncWorldPresentation(phase: WorldSnapshot['phase']): void {
  const playing = phase === 'PLAYING' || phase === 'FINISHED';
  renderer.setVisible(playing);
  if (playing && map && renderedMapHash !== map.hash) {
    renderer.buildMap(map);
    renderedMapHash = map.hash;
  }
}

/** 맵 해시와 같은 자산 묶음이 모두 준비된 경우에만 서버의 lobby ready 상태를 진행한다. */
function confirmSpriteAssetsReady(mapHash: string): void {
  void spriteAssetsReady.then(() => {
    if (map?.hash !== mapHash) return;
    network.send(envelope('C2S_CLIENT_READY', { mapHash, assetsReady: true }) as ClientMessage);
  }).catch(() => hud.showError('스프라이트 자산을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 참가해 주세요.'));
}

/** 서버 메시지를 맵·snapshot·event·phase adapter로 분배하고 권위 결과만 UI에 확정한다. */
function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'S2C_JOINED_ROOM':
      localId = message.payload.playerId as PlayerId;
      localTeam = message.payload.team;
      renderer.setLocalPlayer(localId);
      lobby.joined(message.payload.roomId, message.payload.team, message.payload.lobbyKind, message.payload.rolePreference, localId, message.payload.hostPlayerId as PlayerId | null);
      break;
    case 'S2C_LEFT_ROOM':
      clearRoomSession();
      break;
    case 'S2C_ROLE_PREFERENCE_UPDATED':
      lobby.confirmRolePreference(message.payload.rolePreference);
      break;
    case 'S2C_MAP_DEFINITION':
      if (!verifyMapHash(message.payload.map)) { hud.showError('맵 해시가 일치하지 않습니다. 전체 상태를 다시 요청합니다.'); network.send(envelope('C2S_REQUEST_RESYNC', {}) as ClientMessage); return; }
      map = message.payload.map;
      renderedMapHash = null;
      confirmSpriteAssetsReady(map.hash);
      break;
    case 'S2C_WORLD_SNAPSHOT':
      acceptSnapshot(message.payload);
      break;
    case 'S2C_FULL_STATE':
      if (!verifyMapHash(message.payload.map)) { hud.showError('재동기화된 맵 해시가 올바르지 않습니다.'); return; }
      map = message.payload.map;
      renderedMapHash = null;
      snapshots.clear();
      acceptSnapshot(message.payload.snapshot);
      break;
    case 'S2C_GAME_EVENTS':
      for (const event of message.payload.events) {
        if (seenEventIds.has(event.eventId)) continue;
        seenEventIds.add(event.eventId);
        hud.showTeamNotification(event, localTeam);
        audio.play(event.type);
      }
      if (seenEventIds.size > 2_000) seenEventIds.clear();
      break;
    case 'S2C_CHAT_MESSAGE':
      hud.showChat(message.payload);
      break;
    case 'S2C_MATCH_PHASE':
      syncWorldPresentation(message.payload.phase);
      lobby.setPhase(message.payload.phase, message.payload.countdownEndsAtMs, latest?.serverTimeMs);
      if (message.payload.phase === 'FINISHED' && message.payload.winner && localTeam) hud.result(message.payload.winner, message.payload.reason ?? '', localTeam);
      break;
    case 'S2C_ERROR':
    {
      const admissionError = publicAdmissionError(message.payload.code);
      if (admissionError) { lobby.showError(admissionError); break; }
      if (message.payload.code === 'RECONNECT_EXPIRED') { sessionStorage.removeItem('squirrel-heist-reconnect'); location.reload(); }
      else if (message.payload.code === 'ROOM_SIMULATION_FAILED') {
        sessionStorage.removeItem('squirrel-heist-reconnect');
        network.close();
        hud.showError('Room 오류로 경기가 안전하게 종료되었습니다. 새 경기에 참가하려면 페이지를 새로고침하세요.');
      }
      else if (message.payload.code === 'ROOM_NOT_FOUND') lobby.showError('해당 방을 찾을 수 없습니다. 코드를 확인해 주세요.');
      else if (message.payload.code === 'ROOM_FULL') lobby.showError('방이 가득 찼습니다. 다른 방을 선택해 주세요.');
      else if (message.payload.code === 'ROOM_ALREADY_STARTED') lobby.showError('이미 시작한 방입니다. 다른 방을 선택해 주세요.');
      else if (message.payload.code === 'ROLE_FULL') lobby.showRoleCapacityToast();
      else if (message.payload.code === 'HOST_ONLY') lobby.showError('방장만 이 작업을 할 수 있습니다.');
      else if (message.payload.code === 'PLAYERS_NOT_READY') lobby.showError('8명 모두 역할을 선택하고 준비해야 시작할 수 있습니다.');
      else if (message.payload.code === 'HOST_TRANSFER_REJECTED') lobby.showError('선택한 플레이어에게 방장을 넘길 수 없습니다.');
      else {
        lobby.showError(`서버 오류: ${message.payload.code}`);
        hud.showError(`서버 오류: ${message.payload.code}`);
      }
      break;
    }
    default:
      break;
  }
}

/** 서버가 이탈을 확정한 뒤 Room 종속 상태만 비워 같은 연결에서 메인 로비를 다시 사용한다. */
function clearRoomSession(): void {
  sessionStorage.removeItem('squirrel-heist-reconnect');
  map = null; renderedMapHash = null; latest = null; localId = null; localTeam = null; sequence = 0; clientTick = 0;
  snapshots.clear(); prediction.reset(); renderer.resetSession(); hud.clearChat(); lobby.left();
  renderer.setVisible(false);
}

/** snapshot을 보간 buffer에 넣고 로컬 ack 기준 reconciliation과 HUD 갱신을 수행한다. */
function acceptSnapshot(snapshot: WorldSnapshot): void {
  latest = snapshot;
  syncWorldPresentation(snapshot.phase);
  sequence = Math.max(sequence, snapshot.ackInputSequence + 1);
  snapshots.push(snapshot);
  if (!localId || !map) return;
  const local = snapshot.players.find((player) => player.id === localId);
  if (!local) return;
  localTeam = local.team;
  if (!prediction.isConfigured) prediction.configure(map, local.position);
  else prediction.reconcile(local);
  hud.update(snapshot, map, localId);
  lobby.update(snapshot, localId);
}

setInterval(() => {
  if (!localId || latest?.phase !== 'PLAYING') return;
  updateAimFromPointer();
  const command = input.sample(sequence++, clientTick++);
  network.send(envelope('C2S_INPUT', command) as ClientMessage);
  const local = latest?.players.find((player) => player.id === localId);
  if (local?.mode === 'NORMAL') prediction.apply(command, fixedDeltaMs / 1_000, local.heldAcornId !== null);
}, fixedDeltaMs);

/** 서버 tick과 독립된 frame에서 조준 예측, snapshot 표현 합성, WebGL 렌더를 수행한다. */
function frame(): void {
  requestAnimationFrame(frame);
  if (latest && (latest.phase === 'PLAYING' || latest.phase === 'FINISHED')) {
    updateAimFromPointer();
    const renderNowMs = performance.now();
    const frameDeltaSeconds = (renderNowMs - lastFrameMs) / 1_000;
    const local = localId ? latest.players.find((player) => player.id === localId) : undefined;
    const localPosition = local ? prediction.advanceVisual(input.getMovement(), frameDeltaSeconds, local.heldAcornId !== null, local.mode === 'NORMAL' && latest.phase === 'PLAYING') : null;
    renderer.update(latest, localPosition, localId ? input.getAim() : null, (id) => snapshots.samplePlayer(id, renderNowMs, gameBalance.interpolationDelayMs), renderNowMs);
    lastFrameMs = renderNowMs;
  }
  renderer.render();
}
frame();
