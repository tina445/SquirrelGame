import { BotController, defaultBotPolicyByTeam, type BotPolicySelection } from '@squirrel-heist/bot-core';
import { gameBalance, type PlayerId } from '@squirrel-heist/shared';
import { performance } from 'node:perf_hooks';
import { randomInt } from 'node:crypto';
import type { MatchRoom } from '../simulation/matchRoom.js';

export interface RoomBotCoordinatorOptions {
  enabled?: boolean;
  fillDelayMs?: number;
  fillIntervalMs?: number;
  policies?: BotPolicySelection;
}

interface RoomBotState {
  nextFillAtMs: number;
  controllers: Map<PlayerId, BotController>;
  errorCounts: Map<PlayerId, number>;
}

export class RoomBotCoordinator {
  private readonly states = new Map<string, RoomBotState>();
  private readonly enabled: boolean;
  private readonly fillDelayMs: number;
  private readonly fillIntervalMs: number;
  private readonly policies: BotPolicySelection;

  constructor(options: RoomBotCoordinatorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.fillDelayMs = options.fillDelayMs ?? gameBalance.botFillDelayMs;
    this.fillIntervalMs = options.fillIntervalMs ?? gameBalance.botFillIntervalMs;
    this.policies = options.policies ?? defaultBotPolicyByTeam;
  }

  /** 공개 Room의 대기시간 충원과 PLAYING 봇 입력 생성을 하나의 tick 전 adapter에서 수행한다. */
  beforeTick(room: MatchRoom): void {
    const state = this.stateFor(room);
    this.fillOneDueSlot(room, state);
    if (room.phase !== 'PLAYING') return;
    for (const player of room.botPlayers) {
      if (!player.team) continue;
      let controller = state.controllers.get(player.id);
      if (!controller) {
        controller = new BotController(this.policies[player.team], `${room.map.seed}:${player.id}:${player.team}`, room.nowMs);
        state.controllers.set(player.id, controller);
        state.errorCounts.set(player.id, 0);
      }
      const started = performance.now();
      const input = controller.nextInput(room.map, room.snapshot(), player.id);
      room.metrics.recordBotDecision(performance.now() - started);
      const previousErrors = state.errorCounts.get(player.id) ?? 0;
      if (controller.decisionErrors > previousErrors) {
        room.metrics.botDecisionErrors += controller.decisionErrors - previousErrors;
        state.errorCounts.set(player.id, controller.decisionErrors);
      }
      room.enqueueInput(player.id, input);
    }
  }

  /** 종료·회수된 Room에 딸린 controller 기억과 navigation cache 참조를 제거한다. */
  cleanup(activeRooms: Iterable<MatchRoom>): void {
    const activeIds = new Set([...activeRooms].map((room) => room.id));
    for (const roomId of this.states.keys()) if (!activeIds.has(roomId)) this.states.delete(roomId);
  }

  private fillOneDueSlot(room: MatchRoom, state: RoomBotState): void {
    if (!this.enabled || room.lobbyKind !== 'QUICK_MATCH' || room.phase !== 'LOBBY' || room.activeHumanCount === 0 ||
      room.players.size >= gameBalance.teamSize * 2 || room.nowMs < state.nextFillAtMs) return;
    room.addBot(this.uniqueName(room));
    state.nextFillAtMs = room.nowMs + this.fillIntervalMs;
  }

  private stateFor(room: MatchRoom): RoomBotState {
    let state = this.states.get(room.id);
    if (!state) {
      state = { nextFillAtMs: this.fillDelayMs, controllers: new Map(), errorCounts: new Map() };
      this.states.set(room.id, state);
    }
    return state;
  }

  private uniqueName(room: MatchRoom): string {
    const used = new Set([...room.players.values()].map((player) => player.displayName));
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const name = `다람쥐${String(randomInt(0, 10_000)).padStart(4, '0')}`;
      if (!used.has(name)) return name;
    }
    for (let value = 0; value < 10_000; value += 1) {
      const name = `다람쥐${String(value).padStart(4, '0')}`;
      if (!used.has(name)) return name;
    }
    throw new Error('BOT_DISPLAY_NAME_EXHAUSTED');
  }
}
