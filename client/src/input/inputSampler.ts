import { InputButton, normalize, type InputCommand } from '@squirrel-heist/shared';

/** 실제 키 binding을 게임 좌표의 정규화된 이동 의도로 바꿔 대각선 가속을 방지한다. */
export function movementVectorForKeys(keys: ReadonlySet<string>): { x: number; y: number } {
  const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const y = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  return normalize({ x, y });
}

export class InputSampler {
  private readonly keys = new Set<string>();
  private buttons = 0;
  private aim = { x: 1, y: 0 };
  private pointerClientPosition: { x: number; y: number } | null = null;

  /** DOM 입력을 상태로만 축적하며 게임 규칙 판정은 하지 않는다. */
  constructor(element: HTMLElement) {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'KeyE') this.buttons |= InputButton.INTERACT;
      if (event.code === 'KeyF') this.buttons |= InputButton.ACORN;
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'KeyE') this.buttons &= ~InputButton.INTERACT;
      if (event.code === 'KeyF') this.buttons &= ~InputButton.ACORN;
    });
    element.addEventListener('pointermove', (event) => {
      this.pointerClientPosition = { x: event.clientX, y: event.clientY };
    });
    element.addEventListener('pointerleave', () => { this.pointerClientPosition = null; });
    element.addEventListener('pointerdown', (event) => { if (event.button === 0) this.buttons |= InputButton.FIRE; });
    window.addEventListener('pointerup', (event) => { if (event.button === 0) this.buttons &= ~InputButton.FIRE; });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
  }

  /** 현재 canvas 포인터의 client 좌표를 복사해 렌더 좌표 adapter가 해석하도록 넘긴다. */
  getPointerClientPosition(): { x: number; y: number } | null {
    return this.pointerClientPosition ? { ...this.pointerClientPosition } : null;
  }

  /** 가장 최근의 유효한 정규화 조준을 외부 변경 없이 읽는다. */
  getAim(): { x: number; y: number } { return { ...this.aim }; }

  /** 0벡터는 무시해 포인터가 플레이어와 겹칠 때 마지막 유효 조준을 유지한다. */
  updateAim(aim: { x: number; y: number }): void {
    const next = normalize(aim);
    if (next.x !== 0 || next.y !== 0) this.aim = next;
  }

  /** 현재 입력 상태를 sequence가 있는 순수 의도 패킷으로 snapshot한다. */
  sample(sequence: number, clientTick: number): InputCommand {
    const move = movementVectorForKeys(this.keys);
    return { sequence, clientTick, moveX: move.x, moveY: move.y, aimX: this.aim.x, aimY: this.aim.y, buttons: this.buttons };
  }
}
