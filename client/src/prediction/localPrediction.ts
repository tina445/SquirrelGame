import { clampMagnitude, gameBalance, localMovementToWorld, moveCircle, normalize, scale, subtract, type InputCommand, type MapDefinition, type PlayerSnapshot, type Vec2 } from '@squirrel-heist/shared';

export class LocalPrediction {
  position: Vec2 = { x: 0, y: 0 };
  visualPosition: Vec2 = { x: 0, y: 0 };
  private pending: InputCommand[] = [];
  private map: MapDefinition | null = null;
  private visualCorrection: Vec2 = { x: 0, y: 0 };

  /** 좌표값과 무관하게 권위 맵으로 초기화되었는지 알려 원점 spawn도 안전하게 구분한다. */
  get isConfigured(): boolean { return this.map !== null; }

  /** 권위 맵과 시작 위치로 예측기를 초기화하고 이전 세션의 미확인 입력을 버린다. */
  configure(map: MapDefinition, position: Vec2): void {
    this.map = map; this.position = { ...position }; this.visualPosition = { ...position };
    this.pending = []; this.visualCorrection = { x: 0, y: 0 };
  }

  /** Room 이탈 시 맵과 pending 입력을 폐기해 다음 세션이 새 권위 위치에서 시작하게 한다. */
  reset(): void {
    this.map = null; this.position = { x: 0, y: 0 }; this.visualPosition = { x: 0, y: 0 };
    this.pending = []; this.visualCorrection = { x: 0, y: 0 };
  }

  /** 전송한 입력을 보관하면서 공유 충돌 규칙으로 로컬 위치를 즉시 예측한다. */
  apply(input: InputCommand, deltaSeconds: number, carrying: boolean): void {
    if (!this.map) return;
    this.pending.push(input);
    this.position = this.move(this.position, { x: input.moveX, y: input.moveY }, { x: input.aimX, y: input.aimY }, deltaSeconds, carrying);
  }

  /** ack된 입력을 제거하고 권위 위치에서 미확인 입력을 재생한 뒤 시각 위치에는 오차분만 누적한다. */
  reconcile(authoritative: PlayerSnapshot): void {
    if (!this.map) return;
    this.pending = this.pending.filter((input) => input.sequence > authoritative.lastProcessedInputSequence);
    let replay = { ...authoritative.position };
    for (const input of this.pending) replay = this.move(replay, { x: input.moveX, y: input.moveY }, { x: input.aimX, y: input.aimY }, 1 / gameBalance.serverTickRate, authoritative.heldAcornId !== null);
    this.position = replay;
    const visualError = subtract(replay, this.visualPosition);
    const visualErrorSquared = visualError.x ** 2 + visualError.y ** 2;
    if (authoritative.mode === 'JAILED' || visualErrorSquared > 4) {
      this.visualPosition = { ...replay };
      this.visualCorrection = { x: 0, y: 0 };
    } else this.visualCorrection = visualError;
  }

  /** 현재 입력을 매 render frame 적분하고 reconciliation 오차를 시간 기반으로 감쇠해 20Hz 계단 현상을 숨긴다. */
  advanceVisual(localMovement: Vec2, facing: Vec2, deltaSeconds: number, carrying: boolean, movable: boolean): Vec2 {
    if (!this.map) return this.visualPosition;
    const safeDelta = Math.max(0, Math.min(0.05, deltaSeconds));
    if (movable) this.visualPosition = this.move(this.visualPosition, localMovement, facing, safeDelta, carrying);
    const correctionRatio = Math.min(1, safeDelta * 10);
    const correctionStep = scale(this.visualCorrection, correctionRatio);
    const before = this.visualPosition;
    this.visualPosition = this.moveWorld(this.visualPosition, correctionStep);
    this.visualCorrection = {
      x: this.visualCorrection.x - (this.visualPosition.x - before.x),
      y: this.visualCorrection.y - (this.visualPosition.y - before.y)
    };
    return this.visualPosition;
  }

  /** 서버와 같은 facing 기준 이동속도·운반 감속·벽·hole·나무 줄기 충돌을 적용한다. */
  private move(position: Vec2, localMovement: Vec2, facing: Vec2, deltaSeconds: number, carrying: boolean): Vec2 {
    const direction = localMovementToWorld(clampMagnitude(localMovement), normalize(facing));
    const speed = gameBalance.playerSpeed * (carrying ? gameBalance.carrySpeedMultiplier : 1);
    return this.moveWorld(position, scale(direction, speed * deltaSeconds));
  }

  /** 계산된 월드 delta를 공유 권위 collider에 통과시킨다. */
  private moveWorld(position: Vec2, delta: Vec2): Vec2 {
    return moveCircle(
      position, delta, gameBalance.playerRadius,
      this.map!.bounds, this.map!.staticColliders, this.map!.playableArea, this.map!.playableHoles,
      this.map!.trees.map((tree) => ({ center: tree.center, radius: tree.trunkRadius }))
    );
  }
}
