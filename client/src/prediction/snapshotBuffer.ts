import { gameBalance, lerp, scale, add, type PlayerSnapshot, type Vec2, type WorldSnapshot } from '@squirrel-heist/shared';

interface BufferedSnapshot { snapshot: WorldSnapshot; receivedAtMs: number }
export interface RenderedPlayerPose { position: Vec2; facing: Vec2 }

export class SnapshotBuffer {
  private snapshots: BufferedSnapshot[] = [];
  private serverClockOffsetMs: number | null = null;

  /** 중복 tick을 버리고 로컬 수신시각과 함께 시간순 최근 40개 snapshot만 유지한다. */
  push(snapshot: WorldSnapshot, receivedAtMs = performance.now()): void {
    if (this.snapshots.some((item) => item.snapshot.serverTick === snapshot.serverTick)) return;
    this.snapshots.push({ snapshot, receivedAtMs });
    this.snapshots.sort((a, b) => a.snapshot.serverTimeMs - b.snapshot.serverTimeMs);
    if (this.snapshots.length > 40) this.snapshots.shift();
    const observedOffsetMs = receivedAtMs - snapshot.serverTimeMs;
    this.serverClockOffsetMs = this.serverClockOffsetMs === null ? observedOffsetMs : Math.min(this.serverClockOffsetMs, observedOffsetMs);
  }

  /** Room 전환·full resync에서 과거 시간축이 새 세션 표현에 섞이지 않게 buffer를 비운다. */
  clear(): void { this.snapshots = []; this.serverClockOffsetMs = null; }

  /** 수신 뒤 흐른 시간으로 서버시계를 전진시켜 60fps frame마다 위치·방향을 보간하고 짧은 공백만 제한 외삽한다. */
  samplePlayer(playerId: string, renderNowMs: number, interpolationDelayMs = gameBalance.interpolationDelayMs): RenderedPlayerPose | null {
    const newest = this.snapshots.at(-1);
    if (!newest) return null;
    const estimatedServerTimeMs = renderNowMs - (this.serverClockOffsetMs ?? (newest.receivedAtMs - newest.snapshot.serverTimeMs));
    const targetServerTimeMs = estimatedServerTimeMs - interpolationDelayMs;
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
