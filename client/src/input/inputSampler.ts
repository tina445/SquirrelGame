import { InputButton, normalize, type InputCommand } from '@squirrel-heist/shared';

export class InputSampler {
  private readonly keys = new Set<string>();
  private buttons = 0;
  private aim = { x: 1, y: 0 };

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
      this.aim = normalize({ x: event.clientX - innerWidth / 2, y: -(event.clientY - innerHeight / 2) });
    });
    element.addEventListener('pointerdown', (event) => { if (event.button === 0) this.buttons |= InputButton.FIRE; });
    window.addEventListener('pointerup', (event) => { if (event.button === 0) this.buttons &= ~InputButton.FIRE; });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
  }

  sample(sequence: number, clientTick: number): InputCommand {
    const x = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const y = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const move = normalize({ x, y });
    return { sequence, clientTick, moveX: move.x, moveY: move.y, aimX: this.aim.x, aimY: this.aim.y, buttons: this.buttons };
  }
}
