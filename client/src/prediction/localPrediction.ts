import { clampMagnitude, gameBalance, moveCircle, scale, type InputCommand, type MapDefinition, type PlayerSnapshot, type Vec2 } from '@squirrel-heist/shared';

export class LocalPrediction {
  position: Vec2 = { x: 0, y: 0 };
  private pending: InputCommand[] = [];
  private map: MapDefinition | null = null;

  /** 좌표값과 무관하게 권위 맵으로 초기화되었는지 알려 원점 spawn도 안전하게 구분한다. */
  get isConfigured(): boolean { return this.map !== null; }

  /** 권위 맵과 시작 위치로 예측기를 초기화하고 이전 세션의 미확인 입력을 버린다. */
  configure(map: MapDefinition, position: Vec2): void { this.map = map; this.position = { ...position }; this.pending = []; }

  /** 전송한 입력을 보관하면서 공유 충돌 규칙으로 로컬 위치를 즉시 예측한다. */
  apply(input: InputCommand, deltaSeconds: number, carrying: boolean): void {
    if (!this.map) return;
    this.pending.push(input);
    this.position = this.move(this.position, input, deltaSeconds, carrying);
  }

  /** ack된 입력을 제거하고 권위 위치에서 미확인 입력을 재생한 뒤 오차 크기에 따라 보정한다. */
  reconcile(authoritative: PlayerSnapshot): void {
    if (!this.map) return;
    this.pending = this.pending.filter((input) => input.sequence > authoritative.lastProcessedInputSequence);
    let replay = { ...authoritative.position };
    for (const input of this.pending) replay = this.move(replay, input, 1 / gameBalance.serverTickRate, authoritative.heldAcornId !== null);
    const errorSquared = (replay.x - this.position.x) ** 2 + (replay.y - this.position.y) ** 2;
    this.position = errorSquared > 4 ? replay : { x: this.position.x + (replay.x - this.position.x) * 0.35, y: this.position.y + (replay.y - this.position.y) * 0.35 };
  }

  /** 서버와 같은 이동속도·운반 감속·정적 충돌을 적용하는 예측 전용 순수 단계다. */
  private move(position: Vec2, input: InputCommand, deltaSeconds: number, carrying: boolean): Vec2 {
    const direction = clampMagnitude({ x: input.moveX, y: input.moveY });
    const speed = gameBalance.playerSpeed * (carrying ? gameBalance.carrySpeedMultiplier : 1);
    return moveCircle(position, scale(direction, speed * deltaSeconds), gameBalance.playerRadius, this.map!.bounds, this.map!.staticColliders, this.map!.playableArea);
  }
}
