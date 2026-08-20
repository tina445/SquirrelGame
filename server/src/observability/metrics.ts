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

  /** 최근 2,000 tick의 실행시간만 보존해 장기 실행 중 메모리 사용을 제한한다. */
  recordTick(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > 2_000) this.tickDurations.shift();
  }

  /** 현재 sliding window의 평균/p95와 누적 운영 카운터를 직렬화 가능한 형태로 반환한다. */
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
