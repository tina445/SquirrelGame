import { gameBalance, lerp, scale, add, type PlayerSnapshot, type Vec2, type WorldSnapshot } from '@squirrel-heist/shared';

interface BufferedSnapshot { snapshot: WorldSnapshot; receivedAtMs: number }
export interface RenderedPlayerPose { position: Vec2; facing: Vec2 }

const timingSampleLimit = 40;
const clockOffsetEwmaAlpha = 0.1;

export class SnapshotBuffer {
  private snapshots: BufferedSnapshot[] = [];
  private clockOffsetSamplesMs: number[] = [];
  private interarrivalDeviationSamplesMs: number[] = [];
  private serverClockOffsetMs: number | null = null;
  private lastArrival: BufferedSnapshot | null = null;
  private lastTargetServerTimeMs: number | null = null;

  /** 중복 tick을 버리고 최근 도착 품질을 반영해 서버 시계 오프셋과 interarrival jitter를 추정한다. */
  push(snapshot: WorldSnapshot, receivedAtMs = performance.now()): void {
    if (this.snapshots.some((item) => item.snapshot.serverTick === snapshot.serverTick)) return;
    const buffered = { snapshot, receivedAtMs };
    this.snapshots.push(buffered);
    this.snapshots.sort((a, b) => a.snapshot.serverTimeMs - b.snapshot.serverTimeMs);
    if (this.snapshots.length > timingSampleLimit) this.snapshots.shift();

    const observedOffsetMs = receivedAtMs - snapshot.serverTimeMs;
    appendLimited(this.clockOffsetSamplesMs, observedOffsetMs);
    const lowLatencyOffsetMs = percentile(this.clockOffsetSamplesMs, 0.1);
    this.serverClockOffsetMs = this.serverClockOffsetMs === null
      ? lowLatencyOffsetMs
      : this.serverClockOffsetMs + (lowLatencyOffsetMs - this.serverClockOffsetMs) * clockOffsetEwmaAlpha;

    if (this.lastArrival && snapshot.serverTimeMs > this.lastArrival.snapshot.serverTimeMs) {
      const receivedIntervalMs = receivedAtMs - this.lastArrival.receivedAtMs;
      const serverIntervalMs = snapshot.serverTimeMs - this.lastArrival.snapshot.serverTimeMs;
      appendLimited(this.interarrivalDeviationSamplesMs, Math.abs(receivedIntervalMs - serverIntervalMs));
    }
    if (!this.lastArrival || receivedAtMs >= this.lastArrival.receivedAtMs) this.lastArrival = buffered;
  }

  /** Room 전환·full resync에서 과거 시간축이 새 세션 표현에 섞이지 않게 buffer를 비운다. */
  clear(): void {
    this.snapshots = [];
    this.clockOffsetSamplesMs = [];
    this.interarrivalDeviationSamplesMs = [];
    this.serverClockOffsetMs = null;
    this.lastArrival = null;
    this.lastTargetServerTimeMs = null;
  }

  /** 최근 snapshot 도착 편차의 p95에 맞춰 10Hz 전송을 흡수할 현재 보간 지연을 반환한다. */
  get interpolationDelayMs(): number {
    const jitterP95Ms = percentile(this.interarrivalDeviationSamplesMs, 0.95);
    return clamp(
      gameBalance.interpolationDelayMinMs + jitterP95Ms * gameBalance.interpolationJitterMultiplier,
      gameBalance.interpolationDelayMinMs,
      gameBalance.interpolationDelayMaxMs
    );
  }

  /** 수신 뒤 흐른 시간으로 서버시계를 단조 전진시켜 60fps 위치·방향을 보간하고 짧은 공백만 제한 외삽한다. */
  samplePlayer(playerId: string, renderNowMs: number): RenderedPlayerPose | null {
    const newest = this.snapshots.at(-1);
    if (!newest) return null;
    const estimatedServerTimeMs = renderNowMs - (this.serverClockOffsetMs ?? (newest.receivedAtMs - newest.snapshot.serverTimeMs));
    const candidateTargetServerTimeMs = estimatedServerTimeMs - this.interpolationDelayMs;
    const targetServerTimeMs = this.lastTargetServerTimeMs === null
      ? candidateTargetServerTimeMs
      : Math.max(this.lastTargetServerTimeMs, candidateTargetServerTimeMs);
    this.lastTargetServerTimeMs = targetServerTimeMs;
    const before = [...this.snapshots].reverse().find((item) => item.snapshot.serverTimeMs <= targetServerTimeMs);
    const after = this.snapshots.find((item) => item.snapshot.serverTimeMs >= targetServerTimeMs);
    const a = before?.snapshot.players.find((player) => player.id === playerId);
    const b = after?.snapshot.players.find((player) => player.id === playerId);
    if (!a && !b) return null;
    if (a && b && before && after && before.snapshot.serverTimeMs !== after.snapshot.serverTimeMs && !teleported(a, b)) {
      const alpha = Math.max(0, Math.min(1, (targetServerTimeMs - before.snapshot.serverTimeMs) / (after.snapshot.serverTimeMs - before.snapshot.serverTimeMs)));
      return { position: lerp(a.position, b.position, alpha), facing: interpolateFacing(a.facing, b.facing, alpha) };
    }
    const sample = b ?? a!;
    if (!after && before && sample.mode === 'NORMAL') {
      const extrapolationMs = Math.max(0, Math.min(gameBalance.remoteExtrapolationLimitMs, targetServerTimeMs - before.snapshot.serverTimeMs));
      return { position: add(sample.position, scale(sample.velocity, extrapolationMs / 1_000)), facing: { ...sample.facing } };
    }
    return { position: { ...sample.position }, facing: { ...sample.facing } };
  }
}

/** 재접속 또는 full resync 뒤 서버가 처리한 로컬 입력 다음 sequence부터 안전하게 이어간다. */
export function resumeInputSequence(currentSequence: number, localPlayer: PlayerSnapshot): number {
  return Math.max(currentSequence, localPlayer.lastProcessedInputSequence + 1);
}

/** 방향각의 ±π 경계에서 최단 호를 선택해 원격 다람쥐가 반대 방향으로 한 바퀴 도는 현상을 막는다. */
export function interpolateFacing(a: Vec2, b: Vec2, alpha: number): Vec2 {
  if (a.x === 0 && a.y === 0) return { ...b };
  if (b.x === 0 && b.y === 0) return { ...a };
  const start = Math.atan2(a.x, a.y);
  const end = Math.atan2(b.x, b.y);
  const angle = start + Math.atan2(Math.sin(end - start), Math.cos(end - start)) * alpha;
  return { x: Math.sin(angle), y: Math.cos(angle) };
}

/** 모드 전환 또는 큰 위치 변화가 연속 이동이 아닌 순간이동인지 판정한다. */
const teleported = (a: PlayerSnapshot, b: PlayerSnapshot): boolean => a.mode !== b.mode && (a.mode === 'JAILED' || b.mode === 'JAILED') || (a.position.x - b.position.x) ** 2 + (a.position.y - b.position.y) ** 2 > 16;

/** 고정 길이 timing window에 최신 표본만 유지한다. */
function appendLimited(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > timingSampleLimit) samples.shift();
}

/** 작은 timing window에서 최근 분포의 지정 분위수를 선형 보간 없이 안정적으로 선택한다. */
function percentile(samples: number[], quantile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index]!;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
