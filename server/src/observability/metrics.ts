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
  snapshotPublishCount: number;
  snapshotSentCount: number;
  snapshotSupersededCount: number;
  snapshotSerializationCount: number;
  snapshotSerializationAverageMs: number;
  snapshotSerializationP95Ms: number;
  snapshotSizeAverageBytes: number;
  snapshotSizeP95Bytes: number;
  sendCallbackAverageMs: number;
  sendCallbackP95Ms: number;
  maxBufferedAmountBytes: number;
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
  snapshotPublishCount = 0;
  snapshotSentCount = 0;
  snapshotSupersededCount = 0;
  snapshotSerializationCount = 0;
  maxBufferedAmountBytes = 0;
  private botDecisionDurations: number[] = [];
  private snapshotSerializationDurations: number[] = [];
  private snapshotSizes: number[] = [];
  private sendCallbackDurations: number[] = [];

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

  /** 방 공통 snapshot의 JSON 직렬화 비용과 wire byte 크기를 한 publish당 한 번 기록한다. */
  recordSnapshotSerialization(durationMs: number, sizeBytes: number): void {
    this.snapshotSerializationCount += 1;
    this.pushLimited(this.snapshotSerializationDurations, durationMs);
    this.pushLimited(this.snapshotSizes, sizeBytes);
  }

  /** transport callback까지 걸린 시간을 기록해 운영체제·프록시 송신 큐 지연을 관찰한다. */
  recordSendCallback(durationMs: number): void { this.pushLimited(this.sendCallbackDurations, durationMs); }

  /** 연결별 WebSocket 송신 큐의 관측 최대값을 단조 증가 값으로 보존한다. */
  observeBufferedAmount(bytes: number): void { this.maxBufferedAmountBytes = Math.max(this.maxBufferedAmountBytes, bytes); }

  /** 현재 sliding window의 평균/p95와 누적 운영 카운터를 직렬화 가능한 형태로 반환한다. */
  snapshot(): RoomMetricsSnapshot {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    const botSorted = [...this.botDecisionDurations].sort((a, b) => a - b);
    const botTotal = botSorted.reduce((sum, value) => sum + value, 0);
    const serialization = this.summarize(this.snapshotSerializationDurations);
    const sizes = this.summarize(this.snapshotSizes);
    const callbacks = this.summarize(this.sendCallbackDurations);
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
      botDecisionErrors: this.botDecisionErrors,
      snapshotPublishCount: this.snapshotPublishCount,
      snapshotSentCount: this.snapshotSentCount,
      snapshotSupersededCount: this.snapshotSupersededCount,
      snapshotSerializationCount: this.snapshotSerializationCount,
      snapshotSerializationAverageMs: serialization.average,
      snapshotSerializationP95Ms: serialization.p95,
      snapshotSizeAverageBytes: sizes.average,
      snapshotSizeP95Bytes: sizes.p95,
      sendCallbackAverageMs: callbacks.average,
      sendCallbackP95Ms: callbacks.p95,
      maxBufferedAmountBytes: this.maxBufferedAmountBytes
    };
  }

  /** 고빈도 측정 표본을 최근 2,000개로 제한한다. */
  private pushLimited(target: number[], value: number): void {
    target.push(value);
    if (target.length > 2_000) target.shift();
  }

  /** 빈 표본에도 안정적인 평균과 p95를 반환한다. */
  private summarize(values: number[]): { average: number; p95: number } {
    if (values.length === 0) return { average: 0, p95: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
    };
  }
}
