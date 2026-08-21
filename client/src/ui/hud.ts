import { gameBalance, type InteractionState, type MapDefinition, type PlayerId, type WorldSnapshot } from '@squirrel-heist/shared';
import { teammatesFor } from './lobby.js';
import { MiniMap } from './minimap.js';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;

export class Hud {
  private readonly minimap = new MiniMap(element<HTMLCanvasElement>('minimap'));

  setConnection(text: string): void { element('connection').textContent = text; }
  showError(text: string): void { const node = element('error'); node.hidden = false; node.textContent = text; }
  update(snapshot: WorldSnapshot, map: MapDefinition, localId: PlayerId): void {
    const minutes = Math.floor(snapshot.remainingMs / 60_000);
    const seconds = Math.floor((snapshot.remainingMs % 60_000) / 1_000);
    element('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    element('score').textContent = `도토리 ${snapshot.thiefSecuredCount}/9`;
    const counts = map.storages.map((storage) => snapshot.acorns.filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id).length);
    element('storages').textContent = counts.map((count, index) => `저장소 ${String.fromCharCode(65 + index)} ${count}`).join(' · ');
    const local = snapshot.players.find((player) => player.id === localId);
    this.minimap.update(snapshot, map, localId);
    const teammates = teammatesFor(snapshot.players, localId);
    element('team').textContent = teammates.map((player) => `${player.id === localId ? '★' : player.team === 'THIEF' ? '🐿️' : '🛡️'} ${player.displayName} ${player.mode === 'JAILED' ? '감옥' : player.mode === 'STUNNED' ? '기절' : ''}`).join(' · ');
    element('inventory').textContent = `${local?.heldAcornId ? '도토리 보유' : '도토리 없음'} · ${local?.hasThunder ? '람쥐썬더 보유' : '람쥐썬더 없음'}`;
    const interaction = snapshot.interactions.find((item) => item.playerId === localId)?.state ?? { kind: 'NONE' } as InteractionState;
    const duration = interaction.kind === 'ARREST' ? gameBalance.arrestHoldMs : interaction.kind === 'RESCUE' ? gameBalance.rescueHoldMs : 1;
    const percentage = interaction.kind === 'NONE' ? 0 : Math.min(100, interaction.progressMs / duration * 100);
    element<HTMLElement>('progress').querySelector<HTMLElement>('i')!.style.width = `${percentage}%`;
    element('prompt').textContent = local?.team === 'POLICE' ? '[E] 가까운 도둑 체포 · [F] 도토리 회수/반환 · 클릭 람쥐썬더' : '[E] 감옥에서 구출 · [F] 도토리 들기/놓기 · 클릭 람쥐썬더';
  }
  result(winner: string, reason: string, localTeam: string): void {
    const panel = element('result'); panel.hidden = false;
    panel.querySelector('h1')!.textContent = winner === localTeam ? '승리!' : '패배';
    panel.querySelector('p')!.textContent = reason;
  }
}
