import { Easing, Group, Tween } from '@tweenjs/tween.js';

type EasingFunction = (amount: number) => number;

export interface NumberTweenOptions {
  durationMs: number;
  easing?: EasingFunction;
  repeat?: number;
  yoyo?: boolean;
  onComplete?: () => void;
}

/**
 * 렌더 frame clock 하나로 표현용 tween을 갱신하고 key별 교체·정리를 보장한다.
 * 게임 상태나 서버 시간을 소유하지 않으며 동일 key의 새 효과는 이전 효과를 안전하게 중단한다.
 */
export class AnimationTimeline {
  private readonly group = new Group();
  private readonly tracks = new Map<string, Tween<{ value: number }>>();

  /** 숫자 하나를 보간해 Three.js 속성이나 DOM 스타일에 적용할 수 있는 공통 track을 시작한다. */
  tweenNumber(key: string, from: number, to: number, startMs: number, apply: (value: number) => void, options: NumberTweenOptions): void {
    this.stop(key);
    const state = { value: from };
    const tween = new Tween(state)
      .to({ value: to }, options.durationMs)
      .easing(options.easing ?? Easing.Quadratic.Out)
      .repeat(options.repeat ?? 0)
      .yoyo(options.yoyo ?? false)
      .onUpdate(({ value }) => apply(value))
      .onComplete(() => {
        if (this.tracks.get(key) !== tween) return;
        this.group.remove(tween);
        this.tracks.delete(key);
        options.onComplete?.();
      });
    this.group.add(tween);
    this.tracks.set(key, tween);
    apply(from);
    tween.start(startMs);
  }

  /** 현재 렌더 frame의 단일 시간값으로 등록된 모든 표현 animation을 전진시킨다. */
  update(nowMs: number): void {
    this.group.update(nowMs);
  }

  /** 동일 표현 대상에 새 tween을 연결할 때 기존 track과 group 참조를 함께 제거한다. */
  stop(key: string): void {
    const tween = this.tracks.get(key);
    if (!tween) return;
    tween.stop();
    this.group.remove(tween);
    this.tracks.delete(key);
  }

  /** Room 이탈 시 무한 반복을 포함한 모든 표현 animation을 즉시 정리한다. */
  clear(): void {
    for (const tween of this.tracks.values()) tween.stop();
    this.group.removeAll();
    this.tracks.clear();
  }
}

export const animationEasing = Easing;
