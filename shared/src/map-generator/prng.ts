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

  constructor(seed: string) { this.state = hashSeed(seed) || 0x9e3779b9; }

  next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  range(minimum: number, maximum: number): number { return minimum + this.next() * (maximum - minimum); }
  integer(minimum: number, maximumExclusive: number): number { return Math.floor(this.range(minimum, maximumExclusive)); }
}
