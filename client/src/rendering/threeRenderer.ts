import * as THREE from 'three';
import { gameBalance, type MapDefinition, type TreeDefinition, type WorldSnapshot, type Vec2 } from '@squirrel-heist/shared';
import type { RenderedPlayerPose } from '../prediction/snapshotBuffer.js';

type ViewportRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

/** 게임의 +Y 북쪽을 화면 위로 보이게 Three.js의 -Z축으로 변환한다. */
export function gameToScene(position: Vec2, height = 0): THREE.Vector3 {
  return new THREE.Vector3(position.x, height, -position.y);
}

/** +X가 오른쪽, 게임 +Y가 위가 되는 직교 탑다운 카메라 handedness를 고정한다. */
export function configureTopDownCamera(camera: THREE.OrthographicCamera): void {
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
}

/** client 포인터 ray와 지면의 교점을 게임 좌표로 역변환하며 canvas 밖 좌표는 거부한다. */
export function clientPointToGame(camera: THREE.OrthographicCamera, rect: ViewportRect, clientX: number, clientY: number): Vec2 | null {
  if (rect.width <= 0 || rect.height <= 0 || clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null;
  camera.updateMatrixWorld();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  return intersection ? { x: intersection.x, y: -intersection.z } : null;
}

/** 로컬 플레이어 원이 비충돌 수관 원에 들어왔는지 판정해 해당 클라이언트의 잎만 투명하게 만든다. */
export function isInsideTreeCanopy(position: Vec2, tree: TreeDefinition, playerRadius = gameBalance.playerRadius): boolean {
  const radius = tree.canopyRadius + playerRadius;
  return (position.x - tree.center.x) ** 2 + (position.y - tree.center.y) ** 2 <= radius * radius;
}

export class ThreeRenderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly world = new THREE.Group();
  private readonly entities = new THREE.Group();
  private readonly debug = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
  private playerMeshes = new Map<string, THREE.Mesh>();
  private itemMeshes = new Map<string, THREE.Mesh>();
  private treeCanopies = new Map<string, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();
  private localPlayerId: string | null = null;
  private map: MapDefinition | null = null;

  /** WebGL 표현 계층과 카메라를 구성하며 도메인 상태는 소유하지 않는다. */
  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x17281d);
    container.append(this.renderer.domElement);
    this.scene.add(this.world, this.entities, this.debug);
    configureTopDownCamera(this.camera);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => { if (event.code === 'Backquote' && !event.repeat) this.debug.visible = !this.debug.visible; });
    this.debug.visible = false;
    this.resize();
  }

  /** snapshot 중 로컬 플레이어에만 예측 위치·방향을 선택하도록 ID를 기록한다. */
  setLocalPlayer(id: string): void { this.localPlayerId = id; }

  /** Room 이탈 시 이전 맵·엔티티 표현을 제거하고 다음 JOIN을 위한 빈 scene으로 되돌린다. */
  resetSession(): void {
    this.localPlayerId = null;
    this.map = null;
    this.world.clear(); this.entities.clear(); this.debug.clear();
    this.playerMeshes.clear(); this.itemMeshes.clear(); this.treeCanopies.clear();
  }

  /** 권위 MapDefinition을 표현 mesh로 다시 만들며 충돌 debug는 별도 layer에 둔다. */
  buildMap(map: MapDefinition): void {
    this.map = map;
    this.world.clear(); this.debug.clear(); this.treeCanopies.clear();
    const outline = new THREE.Shape();
    map.playableArea.forEach((point, index) => index === 0 ? outline.moveTo(point.x, point.y) : outline.lineTo(point.x, point.y));
    outline.closePath();
    for (const hole of map.playableHoles) {
      const path = new THREE.Path();
      hole.forEach((point, index) => index === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y));
      path.closePath();
      outline.holes.push(path);
    }
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(outline), new THREE.MeshBasicMaterial({ color: 0x355e3b, side: THREE.DoubleSide }));
    ground.rotation.x = -Math.PI / 2; this.world.add(ground);
    this.addZone(map.thiefBase.center, map.thiefBase.radius, 0xb87938);
    this.addZone(map.jail.center, map.jail.radius, 0x6f7580);
    for (const storage of map.storages) this.addZone(storage.center, storage.radius, 0x315a86);
    for (const box of map.staticColliders) {
      const width = box.max.x - box.min.x; const height = box.max.y - box.min.y;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1.5, height), new THREE.MeshBasicMaterial({ color: 0x244526 }));
      mesh.position.copy(gameToScene({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }, 0.75)); this.world.add(mesh);
      const helper = new THREE.BoxHelper(mesh, 0xff5544); this.debug.add(helper);
    }
    for (const tree of map.trees) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(tree.trunkRadius, tree.trunkRadius * 1.12, 1.4, 18), new THREE.MeshBasicMaterial({ color: 0x70472c }));
      trunk.position.copy(gameToScene(tree.center, 0.7)); this.world.add(trunk);
      const canopy = new THREE.Mesh(
        new THREE.SphereGeometry(tree.canopyRadius, 24, 12),
        new THREE.MeshBasicMaterial({ color: 0x2f7d3d, transparent: true, opacity: 0.92, depthWrite: false })
      );
      canopy.scale.y = 0.3;
      canopy.position.copy(gameToScene(tree.center, 1.85));
      canopy.renderOrder = 3;
      this.world.add(canopy); this.treeCanopies.set(tree.id, canopy);
      const trunkDebug = new THREE.Mesh(new THREE.RingGeometry(tree.trunkRadius - 0.04, tree.trunkRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide }));
      trunkDebug.rotation.x = -Math.PI / 2; trunkDebug.position.copy(gameToScene(tree.center, 0.04)); this.debug.add(trunkDebug);
    }
    for (const point of map.berrySpawnPoints) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(gameBalance.berrySpawnRadius - 0.04, gameBalance.berrySpawnRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xda5b8a, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.copy(gameToScene(point, 0.03)); this.debug.add(marker);
    }
    for (const [team, points] of Object.entries(map.teamSpawns)) for (const point of points) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(gameBalance.playerSpawnRadius - 0.04, gameBalance.playerSpawnRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: team === 'THIEF' ? 0xf2a65a : 0x5ca8e6, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.copy(gameToScene(point, 0.035)); this.debug.add(marker);
    }
  }

  /** snapshot을 mesh에 투영하고 로컬 예측·원격 보간을 표현 단계에서만 합성한다. */
  update(snapshot: WorldSnapshot, localPredicted: Vec2 | null, localPredictedFacing: Vec2 | null, interpolate: (id: string) => RenderedPlayerPose | null): void {
    const activePlayers = new Set<string>(snapshot.players.map((player) => player.id));
    const renderedPositions = new Map<string, Vec2>();
    for (const player of snapshot.players) {
      let mesh = this.playerMeshes.get(player.id);
      if (!mesh) {
        const thief = player.team === 'THIEF';
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.75, 16), new THREE.MeshBasicMaterial({ color: thief ? 0xf2a65a : 0x5ca8e6 }));
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 12), new THREE.MeshBasicMaterial({ color: thief ? 0xb96f32 : 0x326c9b }));
        tail.rotation.z = Math.PI / 2;
        tail.position.set(-0.68, 0, 0);
        mesh.add(tail);
        const teamRing = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.6, 24), new THREE.MeshBasicMaterial({ color: thief ? 0xffd39b : 0xbde3ff, side: THREE.DoubleSide }));
        teamRing.rotation.x = -Math.PI / 2;
        teamRing.position.y = -0.39;
        mesh.add(teamRing);
        this.entities.add(mesh); this.playerMeshes.set(player.id, mesh);
      }
      const interpolated = player.id === this.localPlayerId ? null : interpolate(player.id);
      const position = player.id === this.localPlayerId && localPredicted ? localPredicted : interpolated?.position ?? player.position;
      const facing = player.id === this.localPlayerId && localPredictedFacing ? localPredictedFacing : interpolated?.facing ?? player.facing;
      renderedPositions.set(player.id, position);
      mesh.position.copy(gameToScene(position, 0.4));
      mesh.rotation.y = Math.atan2(facing.y, facing.x);
      mesh.scale.y = player.mode === 'STUNNED' ? 0.55 : 1;
      mesh.visible = true;
      if (player.id === this.localPlayerId) this.follow(position);
    }
    for (const [id, mesh] of this.playerMeshes) if (!activePlayers.has(id)) mesh.visible = false;
    const localPosition = this.localPlayerId ? renderedPositions.get(this.localPlayerId) : undefined;
    if (this.map) for (const tree of this.map.trees) {
      const canopy = this.treeCanopies.get(tree.id);
      if (canopy) canopy.material.opacity = localPosition && isInsideTreeCanopy(localPosition, tree) ? 0.28 : 0.92;
    }
    const items: Array<{ id: string; position: Vec2; color: number; radius: number; height: number }> = [
      ...snapshot.acorns.flatMap((acorn) => {
        if (acorn.location.kind === 'GROUND') return [{ id: acorn.id, position: acorn.location.position, color: 0xc98b3c, radius: 0.23, height: 0.3 }];
        if (acorn.location.kind === 'POLICE_STORAGE') {
          const storageId = acorn.location.storageId;
          const storage = this.map?.storages.find((candidate) => candidate.id === storageId);
          const position = storage?.slotPositions[acorn.location.slot];
          return position ? [{ id: acorn.id, position, color: 0xc98b3c, radius: 0.23, height: 0.3 }] : [];
        }
        if (acorn.location.kind === 'SECURED' && this.map) {
          const slot = acorn.location.slot;
          return [{ id: acorn.id, position: { x: this.map.thiefBase.center.x + (slot % 3 - 1) * 0.55, y: this.map.thiefBase.center.y + (Math.floor(slot / 3) - 1) * 0.55 }, color: 0xf0b94d, radius: 0.23, height: 0.3 }];
        }
        if (acorn.location.kind === 'CARRIED') {
          const carrierId = acorn.location.carrierId;
          const carrier = snapshot.players.find((player) => player.id === carrierId);
          const position = renderedPositions.get(carrierId) ?? carrier?.position;
          return position ? [{ id: acorn.id, position, color: 0xf0b94d, radius: 0.23, height: 1.05 }] : [];
        }
        return [];
      }),
      ...snapshot.berries.map((berry) => ({ id: berry.id, position: berry.position, color: 0xd94c78, radius: 0.28, height: 0.35 })),
      ...snapshot.projectiles.map((projectile) => ({ id: projectile.id, position: projectile.position, color: 0xf6e05e, radius: 0.16, height: 0.5 }))
    ];
    const activeItems = new Set<string>(items.map((item) => item.id));
    for (const item of items) {
      let mesh = this.itemMeshes.get(item.id);
      if (!mesh) { mesh = new THREE.Mesh(new THREE.SphereGeometry(item.radius, 12, 8), new THREE.MeshBasicMaterial({ color: item.color })); this.entities.add(mesh); this.itemMeshes.set(item.id, mesh); }
      mesh.position.copy(gameToScene(item.position, item.height)); mesh.visible = true;
    }
    for (const [id, mesh] of this.itemMeshes) if (!activeItems.has(id)) mesh.visible = false;
  }

  /** 현재 camera와 실제 canvas rect를 사용해 조준용 포인터를 게임 좌표로 변환한다. */
  clientToGame(clientX: number, clientY: number): Vec2 | null {
    return clientPointToGame(this.camera, this.renderer.domElement.getBoundingClientRect(), clientX, clientY);
  }

  /** 현재 scene graph를 한 frame 그리며 게임 상태를 변경하지 않는다. */
  render(): void { this.renderer.render(this.scene, this.camera); }
  /** 원형 목표 zone을 얇은 지면 표현으로 추가한다. */
  private addZone(center: Vec2, radius: number, color: number): void { const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.copy(gameToScene(center, 0.02)); this.world.add(mesh); }
  /** 카메라 방향은 고정한 채 로컬 예측 위치를 부드럽게 추적한다. */
  private follow(position: Vec2): void { this.camera.position.x += (position.x - this.camera.position.x) * 0.08; this.camera.position.z += (-position.y - this.camera.position.z) * 0.08; }
  /** viewport 비율에 맞춰 직교 projection과 WebGL drawing buffer를 함께 갱신한다. */
  private resize(): void { const aspect = innerWidth / innerHeight; const view = 12; this.camera.left = -view * aspect; this.camera.right = view * aspect; this.camera.top = view; this.camera.bottom = -view; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
