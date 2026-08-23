/** 공개 테스트 배포에만 적용할 입장·관측 보호 설정을 환경변수에서 읽는다. */
export interface PublicAccessPolicy {
  maxPlayers: number;
  joinAttemptsPerMinute: number;
  metricsToken: string | null;
  trustProxy: boolean;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** 명시된 값이 없으면 개발 환경의 기존 동작을 보존하고, 공개 배포는 명시적인 상한을 요구한다. */
export function publicAccessPolicy(environment: NodeJS.ProcessEnv = process.env): PublicAccessPolicy {
  return {
    maxPlayers: positiveInteger(environment.MAX_PUBLIC_PLAYERS, Number.POSITIVE_INFINITY),
    joinAttemptsPerMinute: positiveInteger(environment.JOIN_ATTEMPTS_PER_MINUTE, Number.POSITIVE_INFINITY),
    metricsToken: environment.METRICS_TOKEN?.trim() || null,
    trustProxy: environment.TRUST_PROXY === 'true'
  };
}

/** 단일 Cloud Run 인스턴스 안에서만 유지되는 작은 sliding-window 신규 입장 제한기다. */
export class JoinRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  /** 같은 client key의 신규 입장 횟수를 기록하고 현재 window에서 허용되는지 반환한다. */
  allow(clientKey: string, now = Date.now()): boolean {
    if (!Number.isFinite(this.limit)) return true;
    const recent = (this.attempts.get(clientKey) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.attempts.set(clientKey, recent);
      return false;
    }
    recent.push(now);
    this.attempts.set(clientKey, recent);
    return true;
  }
}
