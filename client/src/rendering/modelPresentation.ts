import type { Vec2 } from '@squirrel-heist/shared';

export const modelAssetManifest = {
  squirrel: '/assets/models/low-poly/squirrel.glb',
  forest: '/assets/models/low-poly/forest-props.glb'
} as const;

/** 저폴리 다람쥐의 화면 footprint를 팀 링보다 충분히 크게 고정한다. */
export const playerVisualSize = 2.8;

/** 필드 아이템은 다람쥐와 상호작용 범위를 가리지 않도록 모델 footprint 기준으로 다듬는다. */
export const modelItemScale = {
  fieldAcorn: 1.55,
  storedAcorn: 1.9,
  carriedAcorn: 1.05,
  berry: 0.95
} as const;

export interface LayeredMotionState {
  previousPosition: Vec2 | null;
  previousAtMs: number | null;
  distance: number;
  moving: boolean;
  belowStopSinceMs: number | null;
  movementYaw: number;
}

export interface LayeredMotionSample {
  frame: number;
  moving: boolean;
  movementYaw: number;
  teleported: boolean;
}

export interface AcornPilePose {
  offset: Vec2;
  rotation: number;
  heightOffset: number;
  tiltX: number;
  tiltZ: number;
}

export const createLayeredMotionState = (): LayeredMotionState => ({
  previousPosition: null,
  previousAtMs: null,
  distance: 0,
  moving: false,
  belowStopSinceMs: null,
  movementYaw: 0
});

/** 북쪽을 향해 제작한 저폴리 모델을 game facing에 맞춰 연속 회전할 yaw를 반환한다. */
export function facingYaw(facing: Vec2): number {
  return facing.x === 0 && facing.y === 0 ? 0 : -Math.atan2(facing.x, facing.y);
}

/** 2π 경계를 건널 때 긴 방향으로 회전하지 않도록 목표각과 가장 가까운 동치각을 고른다. */
export function nearestEquivalentAngle(current: number, target: number): number {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

/** 렌더 위치 변화만 누적해 3D 다리 gait와 정지 hysteresis를 구동하고 순간이동은 즉시 idle로 초기화한다. */
export function sampleLayeredMotion(state: LayeredMotionState, position: Vec2, nowMs: number, canWalk: boolean): LayeredMotionSample {
  const previous = state.previousPosition;
  const elapsedMs = state.previousAtMs === null ? 0 : Math.max(0, nowMs - state.previousAtMs);
  const dx = previous ? position.x - previous.x : 0;
  const dy = previous ? position.y - previous.y : 0;
  const displacement = Math.hypot(dx, dy);
  const teleported = previous !== null && (elapsedMs > 250 || displacement > 2);
  const speed = elapsedMs > 0 && !teleported ? displacement / (elapsedMs / 1_000) : 0;

  if (!canWalk || teleported) {
    state.moving = false;
    state.distance = 0;
    state.belowStopSinceMs = null;
  } else if (!state.moving && speed >= 0.12) {
    state.moving = true;
    state.belowStopSinceMs = null;
  } else if (state.moving && speed <= 0.06) {
    state.belowStopSinceMs ??= nowMs;
    if (nowMs - state.belowStopSinceMs >= 80) state.moving = false;
  } else {
    state.belowStopSinceMs = null;
  }

  if (state.moving && !teleported && displacement > 0) {
    state.distance += displacement;
    state.movementYaw = facingYaw({ x: dx, y: dy });
  }
  state.previousPosition = { ...position };
  state.previousAtMs = nowMs;
  return { frame: state.moving ? 1 + Math.floor(state.distance / 0.16) % 4 : 0, moving: state.moving, movementYaw: state.movementYaw, teleported };
}

function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/**
 * 도토리를 하나씩 떨어뜨려 앞선 도토리와 겹치면 수평으로 밀고 높이를 쌓는 결정적 유사 물리 배치다.
 * 게임 상태나 충돌은 전혀 바꾸지 않으며 같은 맵·기지·ID 집합은 언제나 같은 더미를 만든다.
 */
export function simulateAcornPile(mapHash: string, locationKey: string, acornIds: readonly string[], radius: number): Map<string, AcornPilePose> {
  const settled: Array<{ id: string; pose: AcornPilePose }> = [];
  const result = new Map<string, AcornPilePose>();
  const contactDistance = 0.56;
  for (const id of [...acornIds].sort()) {
    const seed = `${mapHash}:${locationKey}:${id}`;
    const angle = hashUnit(`${seed}:angle`) * Math.PI * 2;
    const distance = Math.sqrt(hashUnit(`${seed}:distance`)) * radius * 0.45;
    const offset = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
    for (let iteration = 0; iteration < 12; iteration += 1) {
      for (const { pose } of settled) {
        const dx = offset.x - pose.offset.x;
        const dy = offset.y - pose.offset.y;
        const separation = Math.hypot(dx, dy) || 0.001;
        if (separation >= contactDistance) continue;
        const push = (contactDistance - separation) * 0.58;
        offset.x += dx / separation * push;
        offset.y += dy / separation * push;
      }
      const outside = Math.hypot(offset.x, offset.y);
      if (outside > radius) { offset.x *= radius / outside; offset.y *= radius / outside; }
    }
    let heightOffset = 0.04 + hashUnit(`${seed}:rest`) * 0.05;
    for (const { pose } of settled) {
      const separation = Math.hypot(offset.x - pose.offset.x, offset.y - pose.offset.y);
      if (separation < contactDistance * 1.12) heightOffset = Math.max(heightOffset, pose.heightOffset + (contactDistance * 1.12 - separation) * 0.42);
    }
    const pose: AcornPilePose = {
      offset,
      rotation: (hashUnit(`${seed}:yaw`) - 0.5) * Math.PI * 2,
      heightOffset,
      tiltX: (hashUnit(`${seed}:tilt-x`) - 0.5) * 0.32,
      tiltZ: (hashUnit(`${seed}:tilt-z`) - 0.5) * 0.32
    };
    settled.push({ id, pose });
    result.set(id, pose);
  }
  return result;
}
