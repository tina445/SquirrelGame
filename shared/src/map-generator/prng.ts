/** 문자열 seed를 재현 가능한 32비트 초기 상태로 변환한다. */
export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class SeededRandom {
  private state: number;

  /** 0 상태에 고정되지 않도록 결정론적 대체값을 적용해 PRNG를 초기화한다. */
  constructor(seed: string) { this.state = hashSeed(seed) || 0x9e3779b9; }

  /** xorshift32 상태를 한 단계 진행하고 0 이상 1 미만의 값을 반환한다. */
  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  /** 반열린 실수 구간에서 결정론적 값을 만든다. */
  range(minimum: number, maximum: number): number { return minimum + this.next() * (maximum - minimum); }
  /** 반열린 정수 구간에서 결정론적 값을 만든다. */
  integer(minimum: number, maximumExclusive: number): number { return Math.floor(this.range(minimum, maximumExclusive)); }
}
