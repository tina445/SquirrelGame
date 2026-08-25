import { InputButton, normalize, type InputCommand } from '@squirrel-heist/shared';

/** 실제 키 binding을 게임 좌표의 정규화된 이동 의도로 바꿔 대각선 가속을 방지한다. */
export function movementVectorForKeys(keys: ReadonlySet<string>): { x: number; y: number } {
  const x = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const y = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
  return normalize({ x, y });
}

const arrowMovementCodes = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const actionCodes = new Set(['Space', 'ShiftLeft']);

/** 물리 키 코드만 입력 비트로 변환해 키보드 레이아웃과 게임 행동의 결합을 막는다. */
export function actionButtonForKey(code: string): number {
  if (code === 'Space') return InputButton.INTERACT;
  if (code === 'ShiftLeft') return InputButton.ACORN;
  return 0;
}

export class InputSampler {
  private readonly keys = new Set<string>();
  private buttons = 0;
  private aim = { x: 1, y: 0 };
  private pointerClientPosition: { x: number; y: number } | null = null;

  /** DOM 입력을 상태로만 축적하며 게임 규칙 판정은 하지 않는다. */
  constructor(element: HTMLElement) {
    window.addEventListener('keydown', (event) => {
      if (arrowMovementCodes.has(event.code)) event.preventDefault();
      if (actionCodes.has(event.code)) event.preventDefault();
      this.keys.add(event.code);
      this.buttons |= actionButtonForKey(event.code);
    });
    window.addEventListener('keyup', (event) => {
      if (arrowMovementCodes.has(event.code)) event.preventDefault();
      if (actionCodes.has(event.code)) event.preventDefault();
      this.keys.delete(event.code);
      this.buttons &= ~actionButtonForKey(event.code);
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

  /** 버튼 edge를 소비하지 않고 현재 전후·좌우 이동 의도를 frame 예측에 제공한다. */
  getMovement(): { x: number; y: number } { return movementVectorForKeys(this.keys); }

  /** 0벡터는 무시해 포인터가 플레이어와 겹칠 때 마지막 유효 조준을 유지한다. */
  updateAim(aim: { x: number; y: number }): void {
    const next = normalize(aim);
    if (next.x !== 0 || next.y !== 0) this.aim = next;
  }

  /** 현재 입력 상태를 sequence가 있는 순수 의도 패킷으로 snapshot한다. */
  sample(sequence: number, clientTick: number): InputCommand {
    const move = this.getMovement();
    return { sequence, clientTick, moveX: move.x, moveY: move.y, aimX: this.aim.x, aimY: this.aim.y, buttons: this.buttons };
  }
}
