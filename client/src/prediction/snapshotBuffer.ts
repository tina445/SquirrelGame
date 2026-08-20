import { lerp, type PlayerSnapshot, type Vec2, type WorldSnapshot } from '@squirrel-heist/shared';

export class SnapshotBuffer {
  private snapshots: WorldSnapshot[] = [];

  /** 중복 tick을 버리고 시간순 최근 40개 snapshot만 유지한다. */
  push(snapshot: WorldSnapshot): void {
    if (this.snapshots.some((item) => item.serverTick === snapshot.serverTick)) return;
    this.snapshots.push(snapshot);
    this.snapshots.sort((a, b) => a.serverTimeMs - b.serverTimeMs);
    if (this.snapshots.length > 40) this.snapshots.shift();
  }

  /** 목표 서버시각의 두 snapshot을 보간하되 수감 등 순간이동은 즉시 새 위치로 snap한다. */
  interpolate(playerId: string, targetServerTimeMs: number): Vec2 | null {
    const before = [...this.snapshots].reverse().find((item) => item.serverTimeMs <= targetServerTimeMs);
    const after = this.snapshots.find((item) => item.serverTimeMs >= targetServerTimeMs);
    const a = before?.players.find((player) => player.id === playerId);
    const b = after?.players.find((player) => player.id === playerId);
    if (!a && !b) return null;
    if (!a || !b || !before || !after || before.serverTimeMs === after.serverTimeMs || teleported(a, b)) return { ...(b ?? a)!.position };
    return lerp(a.position, b.position, (targetServerTimeMs - before.serverTimeMs) / (after.serverTimeMs - before.serverTimeMs));
  }
}

/** 모드 전환 또는 큰 위치 변화가 연속 이동이 아닌 순간이동인지 판정한다. */
const teleported = (a: PlayerSnapshot, b: PlayerSnapshot): boolean => a.mode !== b.mode && (a.mode === 'JAILED' || b.mode === 'JAILED') || (a.position.x - b.position.x) ** 2 + (a.position.y - b.position.y) ** 2 > 16;
