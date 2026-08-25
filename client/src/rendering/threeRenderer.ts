import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { distanceSquared, gameBalance, isWithinCircleReach, type JailDefinition, type MapDefinition, type PlayerId, type Team, type TreeDefinition, type WorldSnapshot, type Vec2 } from '@squirrel-heist/shared';
import { AnimationTimeline, animationEasing } from '../animation/animationTimeline.js';
import type { RenderedPlayerPose } from '../prediction/snapshotBuffer.js';
import { createTerrainDecoration } from './terrainChunks.js';
import {
  createLayeredMotionState, facingYaw, modelAssetManifest, modelItemScale, nearestEquivalentAngle, playerVisualSize,
  sampleLayeredMotion, simulateAcornPile, type AcornPilePose, type LayeredMotionState
} from './modelPresentation.js';

type ViewportRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

/** 게임의 +Y 북쪽을 화면 위로 보이게 Three.js의 -Z축으로 변환한다. */
export function gameToScene(position: Vec2, height = 0): THREE.Vector3 {
  return new THREE.Vector3(position.x, height, -position.y);
}

/** 서버가 확정한 시작·끝을 보존하면서 발사 프레임마다 재현 가능한 지그재그 번개 점을 만든다. */
export function thunderArcPoints(start: Vec2, end: Vec2, phase: number, segments = 9): Vec2[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return [start, end];
  const normal = { x: -dy / length, y: dx / length };
  return Array.from({ length: segments + 1 }, (_, index) => {
    if (index === 0) return { ...start };
    if (index === segments) return { ...end };
    const fraction = index / segments;
    const wobble = Math.sin(phase + index * 8.17) * (0.22 + Math.sin(index * 3.71 + phase * 0.6) * 0.16);
    return { x: start.x + dx * fraction + normal.x * wobble, y: start.y + dy * fraction + normal.y * wobble };
  });
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

export interface TeamPalette { body: number; tail: number; ring: number }
export interface CanopyAppearance { opacity: number; depthWrite: boolean }
export type ZoneVisualKind = 'thief-base' | 'police-storage' | 'jail';

/** 거점은 수관과 달리 플레이어가 가려져도 투명화하지 않는 불투명 지형물 팔레트다. */
export function zoneVisualStyle(kind: ZoneVisualKind): { ground: number; rim: number; detail: number } {
  // 도토리의 주황·갈색과 구분되도록 기지는 녹색/청회색, 감옥 목재는 저채도 색으로 제한한다.
  if (kind === 'thief-base') return { ground: 0x3f5c31, rim: 0x627d42, detail: 0x91a64d };
  if (kind === 'police-storage') return { ground: 0x2d4650, rim: 0x49686c, detail: 0x76917d };
  return { ground: 0x3f342a, rim: 0x5a4a38, detail: 0x927d62 };
}

type WorldAsset = 'trunk' | 'canopy' | 'berry' | 'acorn' | 'rock' | 'bush' | 'fence' | 'fencePost';

interface ModelResources {
  squirrelModel: GLTF;
  forestModel: GLTF;
}

interface PlayerVisual {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  model: THREE.Object3D;
  modelLegs: THREE.Object3D[];
  motion: LayeredMotionState;
  facingYaw: number;
}

interface ThunderBeamVisual { root: THREE.Group; glow: THREE.Line; core: THREE.Line }

interface ItemVisualSpec {
  id: string;
  position: Vec2;
  asset: 'acorn' | 'berry';
  scale: number;
  height: number;
  rotation: number;
  tiltX: number;
  tiltZ: number;
}

/** 다른 클라이언트에서는 완전 불투명하고 로컬이 수관 안에 있을 때만 잎을 투과시키는 material 상태를 반환한다. */
export function canopyAppearance(localInside: boolean): CanopyAppearance {
  return localInside ? { opacity: 0.28, depthWrite: false } : { opacity: 1, depthWrite: true };
}

/** GLB 기본 불투명 재질을 수관 opacity tween 직전에 투명 렌더링 경로로 전환한다. */
export function prepareCanopyOpacityTween(materials: readonly (THREE.Material & { opacity: number })[]): void {
  for (const material of materials) {
    material.transparent = true;
    material.depthWrite = false;
    material.needsUpdate = true;
  }
}

/** 수관이 완전히 복원됐을 때만 불투명 depth-write 경로로 되돌려 다른 모델을 가리지 않게 한다. */
export function finishCanopyOpacityTween(materials: readonly (THREE.Material & { opacity: number })[], localInside: boolean): void {
  const appearance = canopyAppearance(localInside);
  for (const material of materials) {
    material.depthWrite = appearance.depthWrite;
    material.transparent = localInside;
    material.needsUpdate = true;
  }
}

/** 역할 확정 전 중립색과 경찰·도둑의 고유 팔레트를 매 frame 선택해 입장 시점의 임시색이 남지 않게 한다. */
export function teamPalette(team: Team | null): TeamPalette {
  if (team === 'THIEF') return { body: 0xf2a65a, tail: 0xb96f32, ring: 0xffd39b };
  if (team === 'POLICE') return { body: 0x4f91d8, tail: 0x245985, ring: 0xbde3ff };
  return { body: 0xa7afa5, tail: 0x68716a, ring: 0xe4e9e3 };
}

export interface ContextualTooltip { id: string; text: string; position: Vec2; height: number }

/** 기절 표식의 visibility는 권위 snapshot 상태만 따르고 회전·맥동은 표현 tween이 담당한다. */
export const stunIndicatorVisible = (mode: string): boolean => mode === 'STUNNED';

/** snapshot과 로컬 위치만으로 기지 trigger 및 현재 가능한 도토리·구출·체포 상호작용 문구를 계산한다. */
export function contextualTooltips(snapshot: WorldSnapshot, map: MapDefinition, localId: string, renderedPositions: Map<string, Vec2>): ContextualTooltip[] {
  const local = snapshot.players.find((player) => player.id === localId);
  const localPosition = local ? renderedPositions.get(local.id) ?? local.position : undefined;
  if (!local || !localPosition || snapshot.phase !== 'PLAYING') return [];
  const results: ContextualTooltip[] = [];
  const zones = [
    { id: 'thief-base', label: '도둑 기지', center: map.thiefBase.center, radius: map.thiefBase.radius },
    ...map.storages.map((storage, index) => ({ id: storage.id, label: `경찰 기지 ${String.fromCharCode(65 + index)}`, center: storage.center, radius: storage.radius })),
    { id: 'jail', label: '감옥', center: map.jail.center, radius: map.jail.radius }
  ];
  for (const zone of zones) if (distanceSquared(localPosition, zone.center) <= (zone.radius + 2.5) ** 2) results.push({ id: `zone-${zone.id}`, text: zone.label, position: zone.center, height: 1.45 });
  if (local.heldAcornId) {
    let action = '[LShift] 도토리 놓기';
    if (local.team === 'THIEF' && distanceSquared(localPosition, map.thiefBase.center) <= map.thiefBase.radius ** 2) action = '[LShift] 도토리 보관';
    else if (local.team === 'POLICE' && map.storages.some((storage) => distanceSquared(localPosition, storage.center) <= storage.radius ** 2)) action = '[LShift] 도토리 반환';
    results.push({ id: 'action-held-acorn', text: action, position: localPosition, height: 2.05 });
  } else {
    const policeCarrier = local.team === 'THIEF' ? snapshot.players
      .filter((player) => player.team === 'POLICE' && player.heldAcornId !== null)
      .map((player) => ({ player, position: renderedPositions.get(player.id) ?? player.position }))
      .filter((candidate) => distanceSquared(localPosition, candidate.position) <= gameBalance.interactionRadius ** 2)
      .sort((first, second) => distanceSquared(localPosition, first.position) - distanceSquared(localPosition, second.position))[0] : undefined;
    if (policeCarrier) results.push({ id: 'action-carried-acorn', text: '[LShift] 도토리 빼앗기', position: policeCarrier.position, height: 2.25 });
    else {
      const groundAcorn = snapshot.acorns.find((acorn) => acorn.location.kind === 'GROUND' && distanceSquared(localPosition, acorn.location.position) <= gameBalance.interactionRadius ** 2);
      if (groundAcorn?.location.kind === 'GROUND') results.push({ id: 'action-ground-acorn', text: '[LShift] 도토리 줍기', position: groundAcorn.location.position, height: 1.2 });
      if (local.team === 'THIEF') for (const storage of map.storages) {
        const available = snapshot.acorns.some((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id);
        if (available && distanceSquared(localPosition, storage.center) <= storage.radius ** 2) results.push({ id: `action-${storage.id}`, text: '[LShift] 도토리 훔치기', position: storage.center, height: 2.5 });
      }
    }
  }
  if (local.team === 'THIEF' && isWithinCircleReach(localPosition, map.jail, gameBalance.interactionRadius)) {
    const jailed = snapshot.players.some((player) => player.team === 'THIEF' && player.mode === 'JAILED');
    if (jailed) results.push({ id: 'action-rescue', text: '[Space] 동료 구출', position: map.jail.center, height: 2.65 });
  }
  if (local.team === 'POLICE') {
    const target = snapshot.players.find((player) => player.team === 'THIEF' && player.mode !== 'JAILED' && distanceSquared(localPosition, renderedPositions.get(player.id) ?? player.position) <= gameBalance.interactionRadius ** 2);
    if (target) results.push({ id: 'action-arrest', text: '[Space] 체포', position: renderedPositions.get(target.id) ?? target.position, height: 2.1 });
  }
  return results;
}

export class ThreeRenderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly modelLights = new THREE.Group();
  private readonly world = new THREE.Group();
  private readonly entities = new THREE.Group();
  private readonly debug = new THREE.Group();
  private readonly animations = new AnimationTimeline();
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
  private playerMeshes = new Map<string, THREE.Group>();
  private playerVisuals = new Map<string, PlayerVisual>();
  private itemMeshes = new Map<string, THREE.Object3D>();
  private readonly appearingItems = new Set<string>();
  private readonly disappearingItems = new Set<string>();
  private readonly fencePostKeys = new Set<string>();
  private treeCanopies = new Map<string, THREE.Object3D>();
  private canopyFaded = new Map<string, boolean>();
  private stunStars = new Map<string, THREE.Group>();
  private thunderBeams = new Map<string, ThunderBeamVisual>();
  private thunderChargeAuras = new Map<PlayerId, THREE.Group>();
  private readonly tooltipLayer = document.createElement('div');
  private readonly tooltips = new Map<string, HTMLDivElement>();
  private localPlayerId: string | null = null;
  private map: MapDefinition | null = null;
  private visible = false;
  private readonly container: HTMLElement;
  private resources: ModelResources | null = null;
  private assetsPromise: Promise<void> | null = null;

  /** WebGL 표현 계층과 카메라를 구성하며 도메인 상태는 소유하지 않는다. */
  constructor(container: HTMLElement) {
    this.container = container;
    this.updateAssetData(false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x17281d);
    container.append(this.renderer.domElement);
    this.tooltipLayer.className = 'world-tooltips';
    container.append(this.tooltipLayer);
    this.setVisible(false);
    this.scene.add(this.world, this.entities, this.debug);
    const hemisphere = new THREE.HemisphereLight(0xfff4d6, 0x29402f, 1.35);
    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    const directional = new THREE.DirectionalLight(0xffefd2, 1.15);
    directional.position.set(-7, 14, -5);
    this.modelLights.add(hemisphere, ambient, directional);
    this.modelLights.visible = true;
    this.scene.add(this.modelLights);
    configureTopDownCamera(this.camera);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Backquote' && !event.repeat) this.debug.visible = !this.debug.visible;
    });
    this.debug.visible = false;
    this.resize();
    void this.prepareAssets().catch((error: unknown) => console.warn('3D 자산을 불러오지 못했습니다.', error));
  }

  /** 맵 ready 신호 전에 저폴리 3D 자산을 preload하고 성공한 경우에만 ready 표식을 노출한다. */
  prepareAssets(): Promise<void> {
    if (this.assetsPromise) return this.assetsPromise;
    this.assetsPromise = this.loadModels().then((resources) => {
      this.resources = resources;
      this.updateAssetData(true);
      if (this.map) this.buildMap(this.map);
    });
    return this.assetsPromise;
  }

  /** snapshot 중 로컬 플레이어에만 예측 위치·방향을 선택하도록 ID를 기록한다. */
  setLocalPlayer(id: string): void { this.localPlayerId = id; }

  /** 대기·카운트다운 중에는 월드 canvas를 숨기고 PLAYING에서만 렌더 비용과 화면 노출을 허용한다. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.renderer.domElement.hidden = !visible;
    this.tooltipLayer.hidden = !visible;
  }

  /** Room 이탈 시 이전 맵·엔티티 표현을 제거하고 다음 JOIN을 위한 빈 scene으로 되돌린다. */
  resetSession(): void {
    this.localPlayerId = null;
    this.map = null;
    this.animations.clear();
    this.disposeGroup(this.world); this.disposeGroup(this.entities); this.disposeGroup(this.debug);
    this.playerMeshes.clear(); this.playerVisuals.clear(); this.itemMeshes.clear(); this.appearingItems.clear(); this.disappearingItems.clear(); this.fencePostKeys.clear(); this.treeCanopies.clear(); this.canopyFaded.clear(); this.stunStars.clear(); this.thunderBeams.clear(); this.thunderChargeAuras.clear();
    this.tooltipLayer.replaceChildren(); this.tooltips.clear();
  }

  /** 권위 MapDefinition을 표현 mesh로 다시 만들며 충돌 debug는 별도 layer에 둔다. */
  buildMap(map: MapDefinition): void {
    this.map = map;
    for (const id of this.treeCanopies.keys()) this.animations.stop(`canopy:${id}`);
    this.disposeGroup(this.world); this.disposeGroup(this.debug); this.fencePostKeys.clear(); this.treeCanopies.clear(); this.canopyFaded.clear();
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
    this.world.add(createTerrainDecoration(map));
    this.addZone(map.thiefBase.center, map.thiefBase.radius, 'thief-base');
    this.addJail(map.jail);
    for (const storage of map.storages) this.addZone(storage.center, storage.radius, 'police-storage');
    for (const box of map.staticColliders) {
      const width = box.max.x - box.min.x; const height = box.max.y - box.min.y;
      const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
      this.addFenceCollider(center, width, height);
      const helper = new THREE.Box3Helper(new THREE.Box3(
        gameToScene({ x: box.min.x, y: box.max.y }, 0),
        gameToScene({ x: box.max.x, y: box.min.y }, 0.06)
      ), 0xff5544);
      this.debug.add(helper);
    }
    for (const tree of map.trees) {
      const trunk = this.createWorldVisual('trunk', tree.trunkRadius * 2.35, tree.trunkRadius * 2.35, 1.16);
      trunk.position.copy(gameToScene(tree.center, 0)); this.world.add(trunk);
      const canopy = this.createWorldVisual('canopy', tree.canopyRadius * 2.25, tree.canopyRadius * 2.25, 1.4);
      canopy.position.copy(gameToScene(tree.center, 1.85));
      canopy.renderOrder = 3;
      this.world.add(canopy); this.treeCanopies.set(tree.id, canopy);
      this.canopyFaded.set(tree.id, false);
      const trunkDebug = new THREE.Mesh(new THREE.RingGeometry(tree.trunkRadius - 0.04, tree.trunkRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide }));
      trunkDebug.rotation.x = -Math.PI / 2; trunkDebug.position.copy(gameToScene(tree.center, 0.04)); this.debug.add(trunkDebug);
    }
    for (const rock of map.rockPiles) {
      const visual = this.createWorldVisual('rock', rock.radius * 2.25, rock.radius * 2.25, 1.22);
      visual.name = `rock-pile:${rock.id}`;
      visual.rotation.y = (Number.parseInt(rock.id.replace(/\D/g, ''), 10) || 0) * 0.73;
      visual.position.copy(gameToScene(rock.center, 0));
      this.world.add(visual);
    }
    for (const bush of map.bushes) {
      const visual = this.createWorldVisual('bush', bush.radius * 2.25, bush.radius * 2.25, 1.24);
      visual.name = `bush-cover:${bush.id}`;
      visual.rotation.y = (Number.parseInt(bush.id.replace(/\D/g, ''), 10) || 0) * 0.91;
      visual.position.copy(gameToScene(bush.center, 0));
      this.world.add(visual);
    }
    for (const point of map.berrySpawnPoints) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(gameBalance.berrySpawnRadius - 0.04, gameBalance.berrySpawnRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xda5b8a, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.copy(gameToScene(point, 0.03)); this.debug.add(marker);
    }
    for (const [team, points] of Object.entries(map.teamSpawns)) for (const point of points) {
      const spawnRadius = team === 'THIEF' ? gameBalance.playerSpawnRadius : gameBalance.policeSpawnRadius;
      const marker = new THREE.Mesh(new THREE.RingGeometry(spawnRadius - 0.04, spawnRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: team === 'THIEF' ? 0xf2a65a : 0x5ca8e6, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.copy(gameToScene(point, 0.035)); this.debug.add(marker);
    }
  }

  /** snapshot을 mesh에 투영하고 로컬 예측·원격 보간을 표현 단계에서만 합성한다. */
  update(snapshot: WorldSnapshot, localPredicted: Vec2 | null, localPredictedFacing: Vec2 | null, interpolate: (id: string) => RenderedPlayerPose | null, renderNowMs = performance.now()): void {
    this.animations.update(renderNowMs);
    const activePlayers = new Set<string>(snapshot.players.map((player) => player.id));
    const renderedPositions = new Map<string, Vec2>();
    for (const player of snapshot.players) {
      let mesh = this.playerMeshes.get(player.id);
      if (!mesh) {
        const visual = this.createPlayerVisual(player.id, player.team);
        mesh = visual.root;
        this.entities.add(mesh); this.playerMeshes.set(player.id, mesh); this.playerVisuals.set(player.id, visual);
      }
      const palette = teamPalette(player.team);
      const visual = this.playerVisuals.get(player.id)!;
      visual.ring.material.color.setHex(palette.ring);
      const interpolated = player.id === this.localPlayerId ? null : interpolate(player.id);
      const position = player.id === this.localPlayerId && localPredicted ? localPredicted : interpolated?.position ?? player.position;
      const facing = player.id === this.localPlayerId && localPredictedFacing ? localPredictedFacing : interpolated?.facing ?? player.facing;
      renderedPositions.set(player.id, position);
      mesh.position.copy(gameToScene(position, 0));
      this.updatePlayerVisual(visual, player.id, position, facing, player.mode === 'NORMAL' && snapshot.phase === 'PLAYING', renderNowMs);
      mesh.scale.setScalar(player.mode === 'STUNNED' ? 0.78 : 1);
      mesh.visible = true;
      let stars = this.stunStars.get(player.id);
      if (!stars) {
        stars = this.createStunStars(player.id, renderNowMs);
        this.entities.add(stars); this.stunStars.set(player.id, stars);
      }
      stars.position.copy(gameToScene(position, 1.48));
      stars.visible = stunIndicatorVisible(player.mode);
      if (player.id === this.localPlayerId) this.follow(position);
    }
    for (const [id, mesh] of this.playerMeshes) if (!activePlayers.has(id)) {
      mesh.visible = false;
      const stars = this.stunStars.get(id); if (stars) stars.visible = false;
    }
    this.updateThunderChargeAuras(snapshot, renderedPositions, renderNowMs);
    const localPosition = this.localPlayerId ? renderedPositions.get(this.localPlayerId) : undefined;
    if (this.map) for (const tree of this.map.trees) {
      const canopy = this.treeCanopies.get(tree.id);
      if (canopy) {
        const faded = Boolean(localPosition && isInsideTreeCanopy(localPosition, tree));
        if (this.canopyFaded.get(tree.id) !== faded) this.transitionCanopy(tree.id, canopy, faded, renderNowMs);
      }
    }
    const storagePiles = new Map<string, Map<string, AcornPilePose>>();
    for (const storage of this.map?.storages ?? []) {
      const ids = snapshot.acorns.filter((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id).map((acorn) => acorn.id);
      storagePiles.set(storage.id, simulateAcornPile(this.map?.hash ?? '', `storage:${storage.id}`, ids, Math.min(0.92, storage.radius * 0.42)));
    }
    const securedPile = this.map ? simulateAcornPile(this.map.hash, 'thief-base', snapshot.acorns.filter((acorn) => acorn.location.kind === 'SECURED').map((acorn) => acorn.id), Math.min(1.45, this.map.thiefBase.radius * 0.45)) : new Map();
    const items: ItemVisualSpec[] = [
      ...snapshot.acorns.flatMap<ItemVisualSpec>((acorn) => {
        if (acorn.location.kind === 'GROUND') return [{ id: acorn.id, position: acorn.location.position, asset: 'acorn' as const, scale: modelItemScale.fieldAcorn, height: 0.12, rotation: 0, tiltX: 0, tiltZ: 0 }];
        if (acorn.location.kind === 'POLICE_STORAGE') {
          const storageId = acorn.location.storageId;
          const storage = this.map?.storages.find((candidate) => candidate.id === storageId);
          const pile = storagePiles.get(storageId)?.get(acorn.id);
          if (!storage || !pile) return [];
          const position = { x: storage.center.x + pile.offset.x, y: storage.center.y + pile.offset.y };
          return [{ id: acorn.id, position, asset: 'acorn' as const, scale: modelItemScale.storedAcorn, height: 0.1 + pile.heightOffset, rotation: pile.rotation, tiltX: pile.tiltX, tiltZ: pile.tiltZ }];
        }
        if (acorn.location.kind === 'SECURED' && this.map) {
          const pile = securedPile.get(acorn.id);
          if (!pile) return [];
          return [{ id: acorn.id, position: { x: this.map.thiefBase.center.x + pile.offset.x, y: this.map.thiefBase.center.y + pile.offset.y }, asset: 'acorn' as const, scale: modelItemScale.storedAcorn, height: 0.1 + pile.heightOffset, rotation: pile.rotation, tiltX: pile.tiltX, tiltZ: pile.tiltZ }];
        }
        if (acorn.location.kind === 'CARRIED') {
          const carrierId = acorn.location.carrierId;
          const carrier = snapshot.players.find((player) => player.id === carrierId);
          const position = renderedPositions.get(carrierId) ?? carrier?.position;
          return position ? [{ id: acorn.id, position, asset: 'acorn' as const, scale: modelItemScale.carriedAcorn, height: 1.25, rotation: 0, tiltX: 0, tiltZ: 0 }] : [];
        }
        return [];
      }),
      ...snapshot.berries.map((berry) => ({ id: berry.id, position: berry.position, asset: 'berry' as const, scale: modelItemScale.berry, height: 0.08, rotation: 0, tiltX: 0, tiltZ: 0 }))
    ];
    const activeItems = new Set<string>(items.map((item) => item.id));
    for (const item of items) {
      let mesh = this.itemMeshes.get(item.id);
      const created = !mesh;
      if (!mesh) {
        mesh = this.createWorldVisual(item.asset, 0.01, 0.01, 0.5, true);
        this.entities.add(mesh); this.itemMeshes.set(item.id, mesh);
        this.appearingItems.add(item.id);
        this.animations.tweenNumber(`item-in:${item.id}`, 0.01, item.scale, renderNowMs, (value) => this.setVisualScale(mesh!, value), {
          durationMs: 150, easing: animationEasing.Back.Out, onComplete: () => this.appearingItems.delete(item.id)
        });
      }
      if (this.disappearingItems.delete(item.id)) {
        this.animations.stop(`item-out:${item.id}`);
        this.setObjectOpacity(mesh, 1);
      }
      if (!created && !this.appearingItems.has(item.id)) this.setVisualScale(mesh, item.scale);
      this.setVisualOrientation(mesh, item.rotation, item.tiltX, item.tiltZ);
      mesh.position.copy(gameToScene(item.position, item.height)); mesh.visible = true;
    }
    for (const [id, mesh] of this.itemMeshes) if (!activeItems.has(id) && !this.disappearingItems.has(id)) this.transitionItemOut(id, mesh, renderNowMs);
    this.updateThunderBeams(snapshot, renderNowMs);
    this.updateTooltips(snapshot, renderedPositions);
  }

  /** 현재 camera와 실제 canvas rect를 사용해 조준용 포인터를 게임 좌표로 변환한다. */
  clientToGame(clientX: number, clientY: number): Vec2 | null {
    return clientPointToGame(this.camera, this.renderer.domElement.getBoundingClientRect(), clientX, clientY);
  }

  /** 저폴리 GLB prefab만 복제해 월드에 배치하며 게임 충돌은 건드리지 않는다. */
  private createWorldVisual(asset: WorldAsset, width: number, height: number, renderOrder: number, animatedScale = false): THREE.Object3D {
    const source = this.findModelNode(this.resources?.forestModel.scene, asset);
    if (!source) throw new Error(`필수 3D prefab을 찾을 수 없습니다: ${asset}`);
    const root = new THREE.Group();
    root.userData.modelVisual = true;
    const model = this.cloneRenderable(source);
    root.add(model);
    this.normalizeWorldModel(model);
    root.scale.set(width, animatedScale ? width : 1, height);
    root.renderOrder = renderOrder;
    return root;
  }

  /** 3D 다람쥐 계층을 만들고 팀 링은 기존 크기와 색으로 유지한다. */
  private createPlayerVisual(playerId: string, team: Team | null): PlayerVisual {
    const root = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.61, 0.7, 24), new THREE.MeshBasicMaterial({ color: teamPalette(team).ring, side: THREE.DoubleSide }));
    ring.name = 'team-ring'; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
    const model = this.cloneRenderable(this.resources?.squirrelModel.scene ?? new THREE.Group());
    model.name = 'squirrel-model'; this.normalizeModel(model, playerVisualSize, playerVisualSize); model.position.y = 0.08;
    const modelLegs = ['legFL', 'legFR', 'legBL', 'legBR']
      .map((name) => model.getObjectByName(name)).filter((node): node is THREE.Object3D => Boolean(node));
    const visual: PlayerVisual = { root, ring, model, modelLegs, motion: createLayeredMotionState(), facingYaw: 0 };
    root.add(ring);
    root.add(model);
    return visual;
  }

  /** 3D 몸통은 조준 방향, 다리는 이동 방향을 따라 연속 회전·gait한다. */
  private updatePlayerVisual(visual: PlayerVisual, _playerId: string, position: Vec2, facing: Vec2, canWalk: boolean, renderNowMs: number): void {
    const motion = sampleLayeredMotion(visual.motion, position, renderNowMs, canWalk);
    visual.facingYaw = nearestEquivalentAngle(visual.facingYaw, facingYaw(facing));
    visual.model.rotation.y = visual.facingYaw;
    const phase = motion.frame === 0 ? 0 : motion.frame / 4 * Math.PI * 2;
    visual.modelLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(phase + (index % 2) * Math.PI) * 0.42; });
    visual.model.position.y = 0.08 + (motion.moving ? Math.abs(Math.sin(phase)) * 0.045 : 0);
    const tail = visual.model.getObjectByName('tail'); if (tail) tail.rotation.y = Math.sin(phase * 0.5) * 0.16;
  }

  /** 권위 AABB를 바꾸지 않고, 동일 경계 좌표를 공유하는 레일·원형 말뚝을 배치한다. */
  private addFenceCollider(center: Vec2, width: number, height: number): void {
    const horizontal = width >= height;
    const length = horizontal ? width : height;
    const thickness = horizontal ? height : width;
    const panels = Math.max(1, Math.ceil(length / 2.8));
    const panelLength = length / panels;
    const start = -length / 2;
    // 레일 자체는 분절하지 않는다. 하나의 길쭉한 통나무가 AABB의 양 끝을 정확히 잇는다.
    const fence = this.createWorldVisual('fence', horizontal ? length : Math.max(thickness, 0.72), horizontal ? Math.max(thickness, 0.72) : length, 1.18);
    if (!horizontal) fence.rotation.y = Math.PI / 2;
    fence.position.copy(gameToScene(center, 0));
    this.setWorldVisualRenderLayer(fence, 10);
    this.world.add(fence);
    const postDiameter = Math.max(0.55, Math.min(0.9, Math.max(thickness, 0.72) * 0.76));
    for (let index = 0; index <= panels; index += 1) {
      const offset = start + panelLength * index;
      const position = horizontal ? { x: center.x + offset, y: center.y } : { x: center.x, y: center.y + offset };
      const postKey = `${position.x.toFixed(3)}:${position.y.toFixed(3)}`;
      if (this.fencePostKeys.has(postKey)) continue;
      this.fencePostKeys.add(postKey);
      const post = this.createWorldVisual('fencePost', postDiameter, postDiameter, 1.2);
      post.position.copy(gameToScene(position, 0.03));
      this.setWorldVisualRenderLayer(post, 11);
      this.world.add(post);
    }
  }

  /** 울타리처럼 겹쳐 놓는 prefab의 모든 renderable에 같은 순서를 부여해 자식 mesh 정렬 차이를 없앤다. */
  private setWorldVisualRenderLayer(visual: THREE.Object3D, renderOrder: number): void {
    visual.renderOrder = renderOrder;
    visual.traverse((node) => { node.renderOrder = renderOrder; });
  }

  /** item이 snapshot에서 사라질 때 짧은 축소·페이드 후 mesh를 제거해 다음 등장 animation과 분리한다. */
  private transitionItemOut(id: string, mesh: THREE.Object3D, renderNowMs: number): void {
    this.animations.stop(`item-in:${id}`);
    this.appearingItems.delete(id);
    this.disappearingItems.add(id);
    const startScale = mesh.scale.x;
    this.animations.tweenNumber(`item-out:${id}`, 0, 1, renderNowMs, (progress) => {
      this.setVisualScale(mesh, Math.max(0.01, startScale * (1 - progress)));
      this.setObjectOpacity(mesh, 1 - progress);
    }, {
      durationMs: 120,
      easing: animationEasing.Quadratic.In,
      onComplete: () => {
        this.entities.remove(mesh);
        this.disposeObject(mesh);
        this.itemMeshes.delete(id);
        this.disappearingItems.delete(id);
      }
    });
  }

  /** 두 저폴리 GLB를 한 번에 읽어 중간 상태가 scene에 노출되지 않게 한다. */
  private async loadModels(): Promise<ModelResources> {
    if (this.resources) return this.resources;
    const loader = new GLTFLoader();
    const [squirrelModel, forestModel] = await Promise.all([
      loader.loadAsync(modelAssetManifest.squirrel), loader.loadAsync(modelAssetManifest.forest)
    ]);
    return { squirrelModel, forestModel };
  }

  /** lobby 준비 상태가 3D GLB preload 완료만 기준으로 삼도록 game root에 기록한다. */
  private updateAssetData(ready: boolean): void {
    this.container.dataset.visualVariant = 'model';
    this.container.dataset.visualReady = String(ready);
  }

  /** GLB authoring 명칭의 대소문자·구분자 차이를 흡수하되 필수 prefab 외 임의 노드는 선택하지 않는다. */
  private findModelNode(scene: THREE.Object3D | undefined, asset: WorldAsset): THREE.Object3D | null {
    if (!scene) return null;
    const aliases: Record<WorldAsset, string[]> = {
      trunk: ['tree-trunk', 'tree_trunk', 'trunk'], canopy: ['tree-canopy', 'tree_canopy', 'canopy'], berry: ['berry'],
      acorn: ['acorn'], rock: ['rock-pile', 'rock_pile', 'rock'], bush: ['bush', 'bush-cover', 'shrub'],
      fence: ['fence-panel', 'fence_panel', 'fence'], fencePost: ['fence-post', 'fence_post', 'fencepost']
    };
    let found: THREE.Object3D | null = null;
    scene.traverse((node) => { if (!found && aliases[asset].includes(node.name.toLowerCase())) found = node; });
    return found;
  }

  /** GLB clone의 geometry·material 소유권을 분리해 개별 제거가 preload 원본을 훼손하지 않게 한다. */
  private cloneRenderable(source: THREE.Object3D): THREE.Object3D {
    const clone = source.clone(true);
    clone.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
      if (mesh.material) mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
    });
    return clone;
  }

  /** prefab의 원점을 바닥 중앙으로 옮기고 요청 footprint 안에 등비 축소·확대한다. */
  private normalizeModel(model: THREE.Object3D, width: number, depth: number): void {
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scalar = Math.min(width / Math.max(size.x, 0.001), depth / Math.max(size.z, 0.001));
    model.scale.multiplyScalar(scalar);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x; model.position.z -= center.z; model.position.y -= bounds.min.y;
  }

  /** 월드 prefab은 authored 종횡비와 무관하게 X/Z bbox를 단위 footprint로 맞추고 높이는 수평 보정의 기하평균만 적용한다. */
  private normalizeWorldModel(model: THREE.Object3D): void {
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scaleX = 1 / Math.max(size.x, 0.001);
    const scaleZ = 1 / Math.max(size.z, 0.001);
    model.scale.multiply(new THREE.Vector3(scaleX, Math.sqrt(scaleX * scaleZ), scaleZ));
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x; model.position.z -= center.z; model.position.y -= bounds.min.y;
  }

  /** GLB 계층의 재질을 모아 수관·아이템 tween과 정리에 같은 adapter를 사용한다. */
  private objectMaterials(object: THREE.Object3D): Array<THREE.Material & { opacity: number }> {
    const result: Array<THREE.Material & { opacity: number }> = [];
    object.traverse((node) => {
      const renderable = node as THREE.Mesh | THREE.Sprite;
      if (!('material' in renderable)) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) if ('opacity' in material) result.push(material as THREE.Material & { opacity: number });
    });
    return result;
  }

  private setObjectOpacity(object: THREE.Object3D, opacity: number): void {
    for (const material of this.objectMaterials(object)) {
      material.transparent = opacity < 1 || material.transparent;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }

  private setVisualScale(object: THREE.Object3D, value: number): void {
    if (object.userData.modelVisual) object.scale.setScalar(value);
    else object.scale.set(value, value, 1);
  }

  /** 더미 도토리의 작은 기울기까지 3D root에 적용해 기계적인 격자 배치를 피한다. */
  private setVisualOrientation(object: THREE.Object3D, rotation: number, tiltX: number, tiltZ: number): void {
    object.rotation.set(tiltX, rotation, tiltZ);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((node) => {
      const renderable = node as THREE.Mesh | THREE.Sprite;
      if ('geometry' in renderable) renderable.geometry.dispose();
      if ('material' in renderable) {
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  /** session/map 교체 시 geometry·material을 해제하되 공유 asset texture는 다음 경기의 preload cache로 보존한다. */
  private disposeGroup(group: THREE.Group): void {
    group.traverse((node) => {
      const renderable = node as THREE.Mesh | THREE.Sprite;
      if ('geometry' in renderable) renderable.geometry.dispose();
      if ('material' in renderable) {
        const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of materials) material.dispose();
      }
    });
    group.clear();
  }

  /** 도둑 기지는 낙엽 둥지, 경찰 보관소는 흙 둥지로 권위 원형 영역만 시각화한다. */
  private addZone(center: Vec2, radius: number, kind: Extract<ZoneVisualKind, 'thief-base' | 'police-storage'>): void {
    const style = zoneVisualStyle(kind);
    const group = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.94, 0.22, 40), new THREE.MeshStandardMaterial({ color: style.ground, roughness: 1 }));
    ground.position.y = 0.11;
    group.add(ground);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.83, radius * 0.12, 8, 40), new THREE.MeshStandardMaterial({ color: style.rim, roughness: 0.92 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.25;
    group.add(rim);
    if (kind === 'thief-base') {
      // 낙엽을 서로 조금씩 겹치게 배치해 바닥 데칼처럼 보이지 않는 둥지를 만든다.
      for (let index = 0; index < 18; index += 1) {
        const angle = index / 18 * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(radius * (0.16 + (index % 3) * 0.015), 0.045, 5), new THREE.MeshStandardMaterial({ color: index % 2 ? style.detail : 0x9c6a2f, roughness: 1 }));
        leaf.position.set(Math.cos(angle) * radius * (0.32 + (index % 4) * 0.1), 0.28 + (index % 3) * 0.008, -Math.sin(angle) * radius * (0.32 + (index % 4) * 0.1));
        leaf.rotation.y = -angle + (index % 3 - 1) * 0.3;
        group.add(leaf);
      }
    } else {
      const hollow = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.52, radius * 0.67, 0.045, 32), new THREE.MeshStandardMaterial({ color: 0x2e2119, roughness: 1 }));
      hollow.position.y = 0.245;
      group.add(hollow);
      for (let index = 0; index < 9; index += 1) {
        const angle = index / 9 * Math.PI * 2;
        const clod = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.105, 0), new THREE.MeshStandardMaterial({ color: index % 2 ? style.detail : style.rim, roughness: 1 }));
        clod.position.set(Math.cos(angle) * radius * 0.74, 0.31, -Math.sin(angle) * radius * 0.74);
        clod.rotation.set(index * 0.4, angle, index * 0.2);
        group.add(clod);
      }
    }
    group.position.copy(gameToScene(center));
    this.world.add(group);
  }
  /** 감옥은 권위 원형 반지름에 맞춘 불투명 목재 바닥·둘레 기둥으로 만든다. */
  private addJail(jail: JailDefinition): void {
    const style = zoneVisualStyle('jail');
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(jail.radius, jail.radius * 0.94, 0.24, 40), new THREE.MeshStandardMaterial({ color: style.ground, roughness: 0.88 }));
    floor.position.copy(gameToScene(jail.center, 0.12));
    this.world.add(floor);
    for (let index = 0; index < 5; index += 1) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(jail.radius * 1.72, 0.055, jail.radius * 0.22), new THREE.MeshStandardMaterial({ color: index % 2 ? style.detail : style.rim, roughness: 0.86 }));
      plank.position.copy(gameToScene({ x: jail.center.x, y: jail.center.y + (index - 2) * jail.radius * 0.31 }, 0.265));
      this.world.add(plank);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(jail.radius - 0.13, 0.13, 8, 48), new THREE.MeshStandardMaterial({ color: style.rim, roughness: 0.84 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(gameToScene(jail.center, 0.72));
    this.world.add(ring);
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const position = { x: jail.center.x + Math.cos(angle) * (jail.radius - 0.13), y: jail.center.y + Math.sin(angle) * (jail.radius - 0.13) };
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.105, 1.25, 8), new THREE.MeshStandardMaterial({ color: style.detail, roughness: 0.9 }));
      bar.position.copy(gameToScene(position, 0.67));
      this.world.add(bar);
    }
  }
  /** 카메라 방향은 고정한 채 로컬 예측 위치를 부드럽게 추적한다. */
  private follow(position: Vec2): void { this.camera.position.x += (position.x - this.camera.position.x) * 0.08; this.camera.position.z += (-position.y - this.camera.position.z) * 0.08; }
  /** renderer 전용 timeline에 회전·맥동 tween을 등록한 세 개의 기절 별을 만든다. */
  private createStunStars(playerId: string, renderNowMs: number): THREE.Group {
    const group = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      const angle = index / 3 * Math.PI * 2;
      star.position.set(Math.cos(angle) * 0.55, Math.sin(angle * 2) * 0.08, Math.sin(angle) * 0.55);
      group.add(star);
    }
    this.animations.tweenNumber(`stun-orbit:${playerId}`, 0, Math.PI * 2, renderNowMs, (value) => { group.rotation.y = value; }, {
      durationMs: 1_050,
      easing: animationEasing.Linear.None,
      repeat: Infinity
    });
    this.animations.tweenNumber(`stun-pulse:${playerId}`, 0.9, 1.12, renderNowMs, (value) => { group.scale.setScalar(value); }, {
      durationMs: 360,
      easing: animationEasing.Sinusoidal.InOut,
      repeat: Infinity,
      yoyo: true
    });
    return group;
  }

  /** 로컬 진입·이탈 때 수관 opacity를 보간하고 depth write 전환 순서를 안전하게 유지한다. */
  private transitionCanopy(treeId: string, canopy: THREE.Object3D, faded: boolean, renderNowMs: number): void {
    this.canopyFaded.set(treeId, faded);
    const appearance = canopyAppearance(faded);
    const materials = this.objectMaterials(canopy);
    prepareCanopyOpacityTween(materials);
    const startOpacity = materials[0]?.opacity ?? 1;
    this.animations.tweenNumber(`canopy:${treeId}`, startOpacity, appearance.opacity, renderNowMs, (value) => { this.setObjectOpacity(canopy, value); }, {
      durationMs: faded ? 140 : 190,
      easing: animationEasing.Quadratic.Out,
      onComplete: () => {
        finishCanopyOpacityTween(materials, faded);
      }
    });
  }

  /** 차지 중인 다람쥐 주변에 서버 mode에서만 파생한 청색 전기 오라를 일렁이게 한다. */
  private updateThunderChargeAuras(snapshot: WorldSnapshot, positions: Map<string, Vec2>, renderNowMs: number): void {
    const active = new Set<string>(snapshot.players.filter((player) => player.mode === 'CHARGING').map((player) => player.id));
    for (const player of snapshot.players) {
      if (player.mode !== 'CHARGING') continue;
      let aura = this.thunderChargeAuras.get(player.id);
      if (!aura) {
        aura = this.createThunderChargeAura();
        this.entities.add(aura);
        this.thunderChargeAuras.set(player.id, aura);
      }
      aura.position.copy(gameToScene(positions.get(player.id) ?? player.position, 0.22));
      aura.visible = true;
      aura.rotation.y = renderNowMs * 0.0024;
      const pulse = 0.92 + Math.sin(renderNowMs * 0.012) * 0.12;
      aura.scale.setScalar(pulse);
      aura.children.forEach((child, index) => {
        const line = child as THREE.Line;
        const geometry = line.geometry as THREE.BufferGeometry;
        const points: THREE.Vector3[] = [];
        for (let step = 0; step <= 12; step += 1) {
          const angle = index * Math.PI * 2 / 3 + step / 12 * Math.PI * 2;
          const radius = 0.62 + index * 0.12 + Math.sin(renderNowMs * 0.018 + step * 4.1 + index) * 0.08;
          points.push(new THREE.Vector3(Math.cos(angle) * radius, 0.06 + (step % 3) * 0.05, Math.sin(angle) * radius));
        }
        geometry.setFromPoints(points);
      });
    }
    for (const [id, aura] of this.thunderChargeAuras) if (!active.has(id)) {
      this.entities.remove(aura);
      this.disposeObject(aura);
      this.thunderChargeAuras.delete(id);
    }
  }

  /** 푸른 외곽 glow와 흰청색 core를 겹친 발사 번개 group을 생성한다. */
  private createThunderBeamVisual(): ThunderBeamVisual {
    const root = new THREE.Group();
    root.name = 'thunder-lightning';
    const glow = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x1677ff, transparent: true, opacity: 0.5 }));
    const core = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xb8f6ff, transparent: true, opacity: 0.98 }));
    glow.name = 'thunder-lightning-glow'; core.name = 'thunder-lightning-core';
    root.add(glow, core);
    this.setWorldVisualRenderLayer(root, 28);
    return { root, glow, core };
  }

  /** 발사 중인 effect의 Arc 점을 갱신해 기존 임시 직선을 청색 번개로 대체한다. */
  private updateThunderBeams(snapshot: WorldSnapshot, renderNowMs: number): void {
    const active = new Set<string>(snapshot.thunderEffects.map((effect) => effect.id));
    for (const effect of snapshot.thunderEffects) {
      let beam = this.thunderBeams.get(effect.id);
      if (!beam) {
        beam = this.createThunderBeamVisual();
        this.entities.add(beam.root); this.thunderBeams.set(effect.id, beam);
      }
      const phase = renderNowMs * 0.028 + effect.id.length * 1.7;
      const corePoints = thunderArcPoints(effect.start, effect.end, phase).map((point, index) => gameToScene(point, 0.9 + (index % 2) * 0.08));
      const glowPoints = thunderArcPoints(effect.start, effect.end, phase + 0.65).map((point, index) => gameToScene(point, 0.86 + (index % 2) * 0.08));
      beam.core.geometry.setFromPoints(corePoints);
      beam.glow.geometry.setFromPoints(glowPoints);
      beam.root.visible = true;
    }
    for (const [id, beam] of this.thunderBeams) if (!active.has(id)) {
      this.entities.remove(beam.root);
      this.disposeObject(beam.root);
      this.thunderBeams.delete(id);
    }
  }

  /** 충전 aura의 세 개 전기 고리를 초기화한다. */
  private createThunderChargeAura(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'thunder-charge-aura';
    for (let index = 0; index < 3; index += 1) {
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: index === 0 ? 0xc4f7ff : 0x2585ff, transparent: true, opacity: 0.92 - index * 0.16 }));
      line.name = `thunder-charge-arc:${index}`;
      group.add(line);
    }
    this.setWorldVisualRenderLayer(group, 27);
    return group;
  }

  /** 로컬 trigger 범위에 들어온 기지와 현재 가능한 상호작용만 월드 좌표 위 HTML 툴팁으로 투영한다. */
  private updateTooltips(snapshot: WorldSnapshot, renderedPositions: Map<string, Vec2>): void {
    const active = new Set<string>();
    if (!this.localPlayerId || !this.map) {
      for (const tooltip of this.tooltips.values()) tooltip.hidden = true;
      return;
    }
    for (const tooltip of contextualTooltips(snapshot, this.map, this.localPlayerId, renderedPositions)) this.showTooltip(tooltip.id, tooltip.text, tooltip.position, tooltip.height, active);
    for (const [id, tooltip] of this.tooltips) if (!active.has(id)) tooltip.hidden = true;
  }

  /** 월드 좌표를 현재 camera viewport의 overlay 좌표로 변환하고 label node를 재사용한다. */
  private showTooltip(id: string, text: string, position: Vec2, height: number, active: Set<string>): void {
    let tooltip = this.tooltips.get(id);
    if (!tooltip) {
      tooltip = document.createElement('div'); tooltip.className = 'world-tooltip';
      this.tooltipLayer.append(tooltip); this.tooltips.set(id, tooltip);
    }
    const projected = gameToScene(position, height).project(this.camera);
    tooltip.textContent = text;
    tooltip.style.left = `${(projected.x + 1) * 50}%`;
    tooltip.style.top = `${(1 - projected.y) * 50}%`;
    tooltip.hidden = projected.z < -1 || projected.z > 1;
    active.add(id);
  }
  /** viewport 비율에 맞춰 직교 projection과 WebGL drawing buffer를 함께 갱신한다. */
  /** visible 상태일 때만 WebGL frame을 제출하며, 로비는 맵을 렌더하지 않는 단색 배경으로 남긴다. */
  render(): void { if (this.visible) this.renderer.render(this.scene, this.camera); }

  private resize(): void { const aspect = innerWidth / innerHeight; const view = 12; this.camera.left = -view * aspect; this.camera.right = view * aspect; this.camera.top = view; this.camera.bottom = -view; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
