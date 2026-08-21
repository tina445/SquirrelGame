export interface RoomMetricsSnapshot {
  tickCount: number;
  averageTickMs: number;
  p95TickMs: number;
  catchUpCount: number;
  invalidMessages: number;
  receivedBytes: number;
  sentBytes: number;
  botCount: number;
  botsAdded: number;
  botDecisionAverageMs: number;
  botDecisionP95Ms: number;
  botDecisionErrors: number;
}

export class RoomMetrics {
  private tickDurations: number[] = [];
  catchUpCount = 0;
  invalidMessages = 0;
  receivedBytes = 0;
  sentBytes = 0;
  botCount = 0;
  botsAdded = 0;
  botDecisionErrors = 0;
  private botDecisionDurations: number[] = [];

  /** 최근 2,000 tick의 실행시간만 보존해 장기 실행 중 메모리 사용을 제한한다. */
  recordTick(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > 2_000) this.tickDurations.shift();
  }

  /** 내장 봇 판단의 제한된 최근 표본을 기록해 tick 예산 침범을 관찰 가능하게 한다. */
  recordBotDecision(durationMs: number): void {
    this.botDecisionDurations.push(durationMs);
    if (this.botDecisionDurations.length > 2_000) this.botDecisionDurations.shift();
  }

  /** 현재 sliding window의 평균/p95와 누적 운영 카운터를 직렬화 가능한 형태로 반환한다. */
  snapshot(): RoomMetricsSnapshot {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const botSorted = [...this.botDecisionDurations].sort((a, b) => a - b);
    const botTotal = botSorted.reduce((sum, value) => sum + value, 0);
    return {
      tickCount: sorted.length,
      averageTickMs: sorted.length === 0 ? 0 : total / sorted.length,
      p95TickMs: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      catchUpCount: this.catchUpCount,
      invalidMessages: this.invalidMessages,
      receivedBytes: this.receivedBytes,
      sentBytes: this.sentBytes,
      botCount: this.botCount,
      botsAdded: this.botsAdded,
      botDecisionAverageMs: botSorted.length === 0 ? 0 : botTotal / botSorted.length,
      botDecisionP95Ms: botSorted[Math.max(0, Math.ceil(botSorted.length * 0.95) - 1)] ?? 0,
      botDecisionErrors: this.botDecisionErrors
    };
  }
}
