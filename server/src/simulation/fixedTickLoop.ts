import { fixedDeltaMs } from '@squirrel-heist/shared';
import type { MatchRoom } from './matchRoom.js';

/** 각 Room tick을 예외 경계 안에서 실행해 한 Room의 실패가 다른 Room으로 전파되지 않게 한다. */
export function tickRooms(rooms: Iterable<MatchRoom>, deltaMs = fixedDeltaMs, beforeTick: (room: MatchRoom) => void = () => undefined): void {
  for (const room of rooms) {
    if (room.phase === 'CLOSED') continue;
    try { beforeTick(room); room.tick(deltaMs); }
    catch (error) {
      console.error(JSON.stringify({
        level: 'error', event: 'room_tick_failed', roomId: room.id, serverTick: room.serverTick,
        detail: error instanceof Error ? error.message : 'unknown error'
      }));
      room.closeWithError();
    }
  }
}

export class FixedTickLoop {
  private timer: NodeJS.Timeout | null = null;
  private previousMs = 0;
  private accumulatorMs = 0;
  /** 매 frame 최신 Room 집합을 얻고 따라잡기 상한과 종료 Room 정리 callback을 구성한다. */
  constructor(
    private readonly rooms: () => Iterable<MatchRoom>,
    private readonly maximumCatchUpTicks = 5,
    private readonly afterFrame: () => void = () => undefined,
    private readonly beforeTick: (room: MatchRoom) => void = () => undefined
  ) {}

  /** accumulator 기준 시각을 초기화하고 fixed step보다 촘촘하게 frame 점검을 시작한다. */
  start(): void {
    if (this.timer) return;
    this.previousMs = performance.now();
    this.timer = setInterval(() => this.frame(), Math.floor(fixedDeltaMs / 2));
  }

  /** 반복 timer를 멱등하게 중단한다. */
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** 누적 wall-clock을 고정 tick으로 소비하고 backlog 제한 후 종료 Room 정리 callback을 실행한다. */
  private frame(): void {
    const now = performance.now();
    this.accumulatorMs += Math.min(now - this.previousMs, fixedDeltaMs * this.maximumCatchUpTicks);
    this.previousMs = now;
    let ticks = 0;
    while (this.accumulatorMs >= fixedDeltaMs && ticks < this.maximumCatchUpTicks) {
      tickRooms(this.rooms(), fixedDeltaMs, this.beforeTick);
      this.accumulatorMs -= fixedDeltaMs;
      ticks += 1;
    }
    if (ticks === this.maximumCatchUpTicks && this.accumulatorMs >= fixedDeltaMs) {
      for (const room of this.rooms()) room.metrics.catchUpCount += 1;
      this.accumulatorMs = 0;
    }
    this.afterFrame();
  }
}
