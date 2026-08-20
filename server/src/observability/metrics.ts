export interface RoomMetricsSnapshot {
  tickCount: number;
  averageTickMs: number;
  p95TickMs: number;
  catchUpCount: number;
  invalidMessages: number;
  receivedBytes: number;
  sentBytes: number;
}

export class RoomMetrics {
  private tickDurations: number[] = [];
  catchUpCount = 0;
  invalidMessages = 0;
  receivedBytes = 0;
  sentBytes = 0;

  recordTick(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > 2_000) this.tickDurations.shift();
  }

  snapshot(): RoomMetricsSnapshot {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
      tickCount: sorted.length,
      averageTickMs: sorted.length === 0 ? 0 : total / sorted.length,
      p95TickMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      catchUpCount: this.catchUpCount,
      invalidMessages: this.invalidMessages,
      receivedBytes: this.receivedBytes,
      sentBytes: this.sentBytes
    };
  }
}
