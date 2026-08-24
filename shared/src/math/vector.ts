import type { Vec2 } from '../domain/types.js';

/** 두 게임 좌표 벡터를 더하며 서버와 클라이언트가 같은 수학 규칙을 공유하게 한다. */
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
/** 첫 좌표에서 두 번째 좌표를 빼 방향·오차 벡터를 만든다. */
export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
/** 벡터 방향을 보존하며 속도나 시간 배율을 적용한다. */
export const scale = (value: Vec2, scalar: number): Vec2 => ({ x: value.x * scalar, y: value.y * scalar });
/** 제곱근 없이 거리·범위 비교에 사용할 벡터 길이의 제곱을 반환한다. */
export const lengthSquared = (value: Vec2): number => value.x * value.x + value.y * value.y;
/** 두 좌표 사이 거리의 제곱을 반환해 시뮬레이션 범위 판정을 결정론적으로 유지한다. */
export const distanceSquared = (a: Vec2, b: Vec2): number => lengthSquared(subtract(a, b));
/** 0벡터는 그대로 두고 나머지는 단위 벡터로 바꿔 대각선 가속을 막는다. */
export const normalize = (value: Vec2): Vec2 => {
  const magnitude = Math.sqrt(lengthSquared(value));
  return magnitude > 0 ? scale(value, 1 / magnitude) : { x: 0, y: 0 };
};
/** 입력 벡터가 허용 크기를 넘을 때만 축소해 서버의 최대 이동 의도를 제한한다. */
export const clampMagnitude = (value: Vec2, maximum = 1): Vec2 => {
  const magnitudeSquared = lengthSquared(value);
  return magnitudeSquared > maximum * maximum ? scale(value, maximum / Math.sqrt(magnitudeSquared)) : value;
};
/** snapshot 보간에서 두 권위 위치 사이의 표현 좌표를 계산한다. */
export const lerp = (a: Vec2, b: Vec2, alpha: number): Vec2 => ({
  x: a.x + (b.x - a.x) * alpha,
  y: a.y + (b.y - a.y) * alpha
});
