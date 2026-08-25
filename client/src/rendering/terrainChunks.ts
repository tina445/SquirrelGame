import * as THREE from 'three';
import { gameBalance, isCircleInPlayableArea, SeededRandom, type MapDefinition, type Vec2 } from '@squirrel-heist/shared';

export const terrainChunkSize = gameBalance.terrainChunkSize;
const grassPerChunk = 9;
const pebblesPerChunk = 3;

export interface TerrainChunkCell {
  column: number;
  row: number;
  center: Vec2;
  tone: number;
}

function hashUnit(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** 맵 바깥·hole을 제외한 10×10 단위의 결정적 장식 청크 목록을 만든다. */
export function terrainChunkCells(map: MapDefinition): TerrainChunkCell[] {
  const cells: TerrainChunkCell[] = [];
  const startX = Math.floor(map.bounds.min.x / terrainChunkSize) * terrainChunkSize;
  const startY = Math.floor(map.bounds.min.y / terrainChunkSize) * terrainChunkSize;
  const endX = Math.ceil(map.bounds.max.x / terrainChunkSize) * terrainChunkSize;
  const endY = Math.ceil(map.bounds.max.y / terrainChunkSize) * terrainChunkSize;
  for (let x = startX, column = 0; x < endX; x += terrainChunkSize, column += 1) {
    for (let y = startY, row = 0; y < endY; y += terrainChunkSize, row += 1) {
      const center = { x: x + terrainChunkSize / 2, y: y + terrainChunkSize / 2 };
      if (!isCircleInPlayableArea(center, 0, map.bounds, map.playableArea, map.playableHoles)) continue;
      cells.push({ column, row, center, tone: Math.floor(hashUnit(`${map.hash}:chunk:${column}:${row}`) * 3) });
    }
  }
  return cells;
}

/** 청크마다 하나의 독립 PRNG 흐름을 사용해 풀·조약돌이 hash 상관관계로 줄지어 보이지 않게 한다. */
export function terrainScatterPositions(mapHash: string, cell: TerrainChunkCell, kind: 'grass' | 'pebble', count: number, inset: number): Vec2[] {
  const random = new SeededRandom(`${mapHash}:terrain:${kind}:${cell.column}:${cell.row}`);
  return Array.from({ length: count }, () => ({
    x: cell.center.x + random.range(-inset, inset),
    y: cell.center.y + random.range(-inset, inset)
  }));
}

const scenePoint = (point: Vec2, height: number): THREE.Vector3 => new THREE.Vector3(point.x, height, -point.y);

/** 두 점을 넘는 주요 경로는 centripetal 곡선으로 보간해 흙길의 꺾임을 완화한다. */
export function dirtPathRenderPoints(points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const curve = new THREE.CatmullRomCurve3(points.map((point) => scenePoint(point, 0)), false, 'centripetal');
  const samples = curve.getPoints((points.length - 1) * 6).map((point) => ({ x: point.x, y: -point.z }));
  // 부동소수점 -0을 포함하지 않고, 거점 접합점은 원본 좌표와 정확히 일치시킨다.
  samples[0] = { ...points[0]! };
  samples[samples.length - 1] = { ...points[points.length - 1]! };
  return samples;
}

/** 곡선 샘플의 좌우 외곽을 하나의 Shape으로 묶어, 사각 선분의 계단식 경계를 없앤다. */
export function dirtPathRibbonGeometry(points: readonly Vec2[], width: number): THREE.ShapeGeometry | null {
  if (points.length < 2) return null;
  const halfWidth = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) continue;
    const normal = { x: -dy / length * halfWidth, y: dx / length * halfWidth };
    left.push({ x: points[index]!.x + normal.x, y: points[index]!.y + normal.y });
    right.push({ x: points[index]!.x - normal.x, y: points[index]!.y - normal.y });
  }
  if (left.length < 2) return null;
  const outline = new THREE.Shape();
  outline.moveTo(left[0]!.x, left[0]!.y);
  for (const point of left.slice(1)) outline.lineTo(point.x, point.y);
  for (const point of right.reverse()) outline.lineTo(point.x, point.y);
  outline.closePath();
  return new THREE.ShapeGeometry(outline);
}

/**
 * 맵 정의에서만 파생한 장식 그룹이다. 10×10 잔디 청크, 경로 흙길, 조약돌은 렌더링 전용이며
 * 권위 충돌·시야·맵 hash에 새 게임 규칙을 추가하지 않는다.
 */
export function createTerrainDecoration(map: MapDefinition): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain-chunks';
  const cells = terrainChunkCells(map);
  // 청크는 생성 단위일 뿐 타일이 아니므로, 색·틈 대비를 없애 넓은 초원으로 읽히게 한다.
  const meadowMaterial = new THREE.MeshLambertMaterial({ color: 0x3b7042 });
  for (const cell of cells) {
    const chunk = new THREE.Mesh(new THREE.PlaneGeometry(terrainChunkSize + 0.18, terrainChunkSize + 0.18), meadowMaterial);
    chunk.name = `terrain-chunk:${cell.column}:${cell.row}`;
    chunk.rotation.x = -Math.PI / 2;
    chunk.position.copy(scenePoint(cell.center, 0.004));
    group.add(chunk);
  }

  const grassBlade = new THREE.ConeGeometry(0.11, 0.42, 4);
  const grass = new THREE.InstancedMesh(grassBlade, new THREE.MeshLambertMaterial({ color: 0x75b45a }), cells.length * grassPerChunk);
  grass.name = 'terrain-grass-blades';
  const pebble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.252, 0), new THREE.MeshLambertMaterial({ color: 0xaab2a6 }), cells.length * pebblesPerChunk);
  pebble.name = 'terrain-pebbles';
  const transform = new THREE.Object3D();
  let grassIndex = 0;
  let pebbleIndex = 0;
  for (const cell of cells) {
    const grassRandom = new SeededRandom(`${map.hash}:terrain:grass-style:${cell.column}:${cell.row}`);
    for (const position of terrainScatterPositions(map.hash, cell, 'grass', grassPerChunk, 4.35)) {
      transform.position.copy(scenePoint(position, 0.22));
      transform.rotation.set(0, grassRandom.next() * Math.PI * 2, 0);
      transform.scale.set(0.8 + grassRandom.next() * 0.9, 0.95 + grassRandom.next() * 0.95, 0.8 + grassRandom.next() * 0.9);
      transform.updateMatrix();
      grass.setMatrixAt(grassIndex++, transform.matrix);
    }
    const pebbleRandom = new SeededRandom(`${map.hash}:terrain:pebble-style:${cell.column}:${cell.row}`);
    // 현재 평균 2.25개에서 약 10% 낮춘 평균 2.025개가 되도록 2.5% 청크에만 세 번째 조약돌을 둔다.
    const pebbleCount = 2 + (pebbleRandom.next() < 0.025 ? 1 : 0);
    for (const position of terrainScatterPositions(map.hash, cell, 'pebble', pebbleCount, 4.1)) {
      transform.position.copy(scenePoint(position, 0.12));
      transform.rotation.set(pebbleRandom.next() * Math.PI, pebbleRandom.next() * Math.PI, pebbleRandom.next() * Math.PI);
      transform.scale.setScalar(0.8 + pebbleRandom.next() * 0.85);
      transform.updateMatrix();
      pebble.setMatrixAt(pebbleIndex++, transform.matrix);
    }
  }
  grass.count = grassIndex;
  pebble.count = pebbleIndex;
  group.add(grass, pebble);

  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x96744b });
  for (const path of map.dirtPaths) {
    const points = dirtPathRenderPoints(path.points);
    const geometry = dirtPathRibbonGeometry(points, path.width);
    if (!geometry) continue;
    const road = new THREE.Mesh(geometry, roadMaterial);
    road.name = 'terrain-dirt-path';
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.035;
    group.add(road);
  }
  return group;
}
