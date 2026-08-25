import * as THREE from 'three';
import { gameBalance, isCircleInPlayableArea, type MapDefinition, type Vec2 } from '@squirrel-heist/shared';

export const terrainChunkSize = gameBalance.terrainChunkSize;
const grassPerChunk = 12;
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

const scenePoint = (point: Vec2, height: number): THREE.Vector3 => new THREE.Vector3(point.x, height, -point.y);

/**
 * 맵 정의에서만 파생한 장식 그룹이다. 10×10 잔디 청크, 경로 흙길, 조약돌은 렌더링 전용이며
 * 권위 충돌·시야·맵 hash에 새 게임 규칙을 추가하지 않는다.
 */
export function createTerrainDecoration(map: MapDefinition): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain-chunks';
  // 청크는 생성 단위일 뿐 타일이 아니므로, 색·틈 대비를 없애 넓은 초원으로 읽히게 한다.
  const meadowMaterial = new THREE.MeshLambertMaterial({ color: 0x3b7042 });
  for (const cell of terrainChunkCells(map)) {
    const chunk = new THREE.Mesh(new THREE.PlaneGeometry(terrainChunkSize + 0.18, terrainChunkSize + 0.18), meadowMaterial);
    chunk.name = `terrain-chunk:${cell.column}:${cell.row}`;
    chunk.rotation.x = -Math.PI / 2;
    chunk.position.copy(scenePoint(cell.center, 0.004));
    group.add(chunk);
  }

  const grassBlade = new THREE.ConeGeometry(0.11, 0.42, 4);
  const grass = new THREE.InstancedMesh(grassBlade, new THREE.MeshLambertMaterial({ color: 0x75b45a }), terrainChunkCells(map).length * grassPerChunk);
  grass.name = 'terrain-grass-blades';
  const pebble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.28, 0), new THREE.MeshLambertMaterial({ color: 0xaab2a6 }), terrainChunkCells(map).length * pebblesPerChunk);
  pebble.name = 'terrain-pebbles';
  const transform = new THREE.Object3D();
  let grassIndex = 0;
  let pebbleIndex = 0;
  for (const cell of terrainChunkCells(map)) {
    for (let index = 0; index < grassPerChunk; index += 1) {
      const seed = `${map.hash}:grass:${cell.column}:${cell.row}:${index}`;
      transform.position.copy(scenePoint({
        x: cell.center.x + (hashUnit(`${seed}:x`) - 0.5) * 8.6,
        y: cell.center.y + (hashUnit(`${seed}:y`) - 0.5) * 8.6
      }, 0.22));
      transform.rotation.set(0, hashUnit(`${seed}:rotation`) * Math.PI * 2, 0);
      transform.scale.setScalar(0.95 + hashUnit(`${seed}:scale`) * 0.95);
      transform.updateMatrix();
      grass.setMatrixAt(grassIndex++, transform.matrix);
    }
    for (let index = 0; index < pebblesPerChunk; index += 1) {
      const seed = `${map.hash}:pebble:${cell.column}:${cell.row}:${index}`;
      transform.position.copy(scenePoint({
        x: cell.center.x + (hashUnit(`${seed}:x`) - 0.5) * 7.8,
        y: cell.center.y + (hashUnit(`${seed}:y`) - 0.5) * 7.8
      }, 0.12));
      transform.rotation.set(hashUnit(`${seed}:rx`) * Math.PI, hashUnit(`${seed}:ry`) * Math.PI, hashUnit(`${seed}:rz`) * Math.PI);
      transform.scale.setScalar(0.8 + hashUnit(`${seed}:scale`) * 0.85);
      transform.updateMatrix();
      pebble.setMatrixAt(pebbleIndex++, transform.matrix);
    }
  }
  grass.count = grassIndex;
  pebble.count = pebbleIndex;
  group.add(grass, pebble);

  const segmentKeys = new Set<string>();
  for (const path of map.dirtPaths) for (let index = 1; index < path.points.length; index += 1) {
    const start = path.points[index - 1]!;
    const end = path.points[index]!;
    const key = [start.x.toFixed(2), start.y.toFixed(2), end.x.toFixed(2), end.y.toFixed(2)].join(':');
    if (segmentKeys.has(key)) continue;
    segmentKeys.add(key);
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const road = new THREE.Mesh(new THREE.BoxGeometry(length + 0.4, 0.045, path.width), new THREE.MeshLambertMaterial({ color: 0x96744b }));
    road.name = 'terrain-dirt-path';
    road.position.copy(scenePoint({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, 0.035));
    road.rotation.y = Math.atan2(-(end.y - start.y), end.x - start.x);
    group.add(road);
  }
  return group;
}
