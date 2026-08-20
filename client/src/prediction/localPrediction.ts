import { clampMagnitude, gameBalance, moveCircle, scale, type InputCommand, type MapDefinition, type PlayerSnapshot, type Vec2 } from '@squirrel-heist/shared';

export class LocalPrediction {
  position: Vec2 = { x: 0, y: 0 };
  private pending: InputCommand[] = [];
  private map: MapDefinition | null = null;

  configure(map: MapDefinition, position: Vec2): void { this.map = map; this.position = { ...position }; this.pending = []; }

  apply(input: InputCommand, deltaSeconds: number, carrying: boolean): void {
    if (!this.map) return;
    this.pending.push(input);
    this.position = this.move(this.position, input, deltaSeconds, carrying);
  }

  reconcile(authoritative: PlayerSnapshot): void {
    if (!this.map) return;
    this.pending = this.pending.filter((input) => input.sequence > authoritative.lastProcessedInputSequence);
    let replay = { ...authoritative.position };
    for (const input of this.pending) replay = this.move(replay, input, 1 / gameBalance.serverTickRate, authoritative.heldAcornId !== null);
    const errorSquared = (replay.x - this.position.x) ** 2 + (replay.y - this.position.y) ** 2;
    this.position = errorSquared > 4 ? replay : { x: this.position.x + (replay.x - this.position.x) * 0.35, y: this.position.y + (replay.y - this.position.y) * 0.35 };
  }

  private move(position: Vec2, input: InputCommand, deltaSeconds: number, carrying: boolean): Vec2 {
    const direction = clampMagnitude({ x: input.moveX, y: input.moveY });
    const speed = gameBalance.playerSpeed * (carrying ? gameBalance.carrySpeedMultiplier : 1);
    return moveCircle(position, scale(direction, speed * deltaSeconds), gameBalance.playerRadius, this.map!.bounds, this.map!.staticColliders);
  }
}
