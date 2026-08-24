import { gameBalance, type GameEvent, type InteractionState, type MapDefinition, type PlayerId, type Team, type WorldSnapshot } from '@squirrel-heist/shared';
import { teammatesFor } from './lobby.js';
import { MiniMap } from './minimap.js';
import { TeamToast } from './teamToast.js';

const element = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!;
export interface ChatMessage { senderId: string; displayName: string; team: Team; text: string }

export class Hud {
  onChat: (text: string) => void = () => undefined;
  private readonly minimap = new MiniMap(element<HTMLCanvasElement>('minimap'));
  private readonly teamToast = new TeamToast(element('team-toast'));
  private playerSignature = '';

  /** HUD 내부의 보조 패널은 월드 입력을 막지 않도록 필요한 버튼에만 직접 이벤트를 연결한다. */
  constructor() {
    const toggle = element<HTMLButtonElement>('chat-toggle');
    const content = element('chat-content');
    toggle.addEventListener('click', () => {
      const open = content.hidden;
      content.hidden = !open;
      toggle.textContent = open ? '접기' : '열기';
      toggle.setAttribute('aria-expanded', String(open));
    });
    element<HTMLFormElement>('chat-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = element<HTMLInputElement>('chat-input');
      const text = input.value.trim();
      if (!text) return;
      this.onChat(text);
      input.value = '';
    });
  }

  setConnection(text: string): void { element('connection').textContent = text; }
  showError(text: string): void { const node = element('error'); node.hidden = false; node.textContent = text; }
  /** 서버가 해당 팀에만 전송한 행동 결과를 현재 경기 HUD에서 잠시 강조한다. */
  showTeamNotification(event: GameEvent, localTeam: Team | null): void { this.teamToast.show(event, localTeam); }
  update(snapshot: WorldSnapshot, map: MapDefinition, localId: PlayerId): void {
    const minutes = Math.floor(snapshot.remainingMs / 60_000);
    const seconds = Math.floor((snapshot.remainingMs % 60_000) / 1_000);
    element('timer').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    element('score').textContent = `도토리 ${snapshot.thiefSecuredCount}/9`;
    const counts = map.storages.map((storage) => snapshot.acorns.filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id).length);
    element('storages').textContent = counts.map((count, index) => `저장소 ${String.fromCharCode(65 + index)} ${count}`).join(' · ');
    for (const [index, count] of counts.entries()) element(`storage-${String.fromCharCode(97 + index)}`).innerHTML = `${String.fromCharCode(65 + index)} <b>${count}</b>`;
    const local = snapshot.players.find((player) => player.id === localId);
    this.minimap.update(snapshot, map, localId);
    const teammates = teammatesFor(snapshot.players, localId);
    element('team').textContent = teammates.map((player) => `${player.id === localId ? '★' : player.team === 'THIEF' ? '🐿️' : '🛡️'} ${player.displayName} ${player.mode === 'JAILED' ? '감옥' : player.mode === 'STUNNED' ? '기절' : ''}`).join(' · ');
    this.renderPlayers(snapshot, localId);
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

  /** 서버가 확정해 중계한 메시지만 DOM에 추가하며, 최근 30개를 넘는 과거 채팅은 제거한다. */
  showChat({ displayName, team, text }: ChatMessage): void {
    const messages = element('chat-messages');
    const line = document.createElement('p');
    line.className = `chat-message ${team.toLowerCase()}`;
    const sender = document.createElement('strong'); sender.textContent = `${displayName}: `;
    line.append(sender, document.createTextNode(text));
    messages.append(line);
    while (messages.childElementCount > 30) messages.firstElementChild?.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  clearChat(): void { element('chat-messages').replaceChildren(); }

  /** 전원 명단을 팀 색과 수감 상태로 표시해 경기 중 팀원·상대의 상태를 한눈에 보여 준다. */
  private renderPlayers(snapshot: WorldSnapshot, localId: PlayerId): void {
    const signature = snapshot.players.map((player) => [player.id, player.displayName, player.team, player.mode, player.id === localId]).join('|');
    if (signature === this.playerSignature) return;
    this.playerSignature = signature;
    const list = element('all-players');
    list.replaceChildren(...snapshot.players.map((player) => {
      const item = document.createElement('div');
      item.className = `player-entry ${player.team?.toLowerCase() ?? ''}${player.mode === 'JAILED' ? ' jailed' : ''}`;
      const mark = document.createElement('span'); mark.className = 'player-mark'; mark.textContent = player.id === localId ? '★' : '●';
      const name = document.createElement('span'); name.className = 'player-name';
      name.textContent = `${player.displayName}${player.mode === 'JAILED' ? ' [감옥]' : player.mode === 'STUNNED' ? ' [기절]' : ''}`;
      item.append(mark, name);
      return item;
    }));
  }
}
