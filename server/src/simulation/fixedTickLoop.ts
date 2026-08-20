import { fixedDeltaMs } from '@squirrel-heist/shared';
import type { MatchRoom } from './matchRoom.js';

export class FixedTickLoop {
  private timer: NodeJS.Timeout | null = null;
  private previousMs = 0;
  private accumulatorMs = 0;
  constructor(private readonly rooms: () => Iterable<MatchRoom>, private readonly maximumCatchUpTicks = 5) {}

  start(): void {
    if (this.timer) return;
    this.previousMs = performance.now();
    this.timer = setInterval(() => this.frame(), Math.floor(fixedDeltaMs / 2));
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private frame(): void {
    const now = performance.now();
    this.accumulatorMs += Math.min(now - this.previousMs, fixedDeltaMs * this.maximumCatchUpTicks);
    this.previousMs = now;
    let ticks = 0;
    while (this.accumulatorMs >= fixedDeltaMs && ticks < this.maximumCatchUpTicks) {
      for (const room of this.rooms()) room.tick(fixedDeltaMs);
      this.accumulatorMs -= fixedDeltaMs;
      ticks += 1;
    }
    if (ticks === this.maximumCatchUpTicks && this.accumulatorMs >= fixedDeltaMs) {
      for (const room of this.rooms()) room.metrics.catchUpCount += 1;
      this.accumulatorMs = 0;
    }
  }
}
