import * as THREE from 'three';
import { distanceSquared, gameBalance, isWithinCircleReach, type JailDefinition, type MapDefinition, type Team, type TreeDefinition, type WorldSnapshot, type Vec2 } from '@squirrel-heist/shared';
import { AnimationTimeline, animationEasing } from '../animation/animationTimeline.js';
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

export interface TeamPalette { body: number; tail: number; ring: number }
export interface CanopyAppearance { opacity: number; depthWrite: boolean }

const spriteAssetPaths = {
  squirrel: '/assets/sprites/squirrel-walk.png',
  trunk: '/assets/sprites/tree-trunk.png',
  canopy: '/assets/sprites/tree-canopy.png',
  berry: '/assets/sprites/berry.png',
  acorn: '/assets/sprites/acorn.png',
  rock: '/assets/sprites/rock-pile.png',
  fence: '/assets/sprites/fence-panel.png'
} as const;

type SpriteAsset = keyof typeof spriteAssetPaths;

/** 8방향 facing을 북쪽부터 시계 방향인 스프라이트 아틀라스 행으로 양자화한다. */
export function squirrelFacingRow(facing: Vec2): number {
  if (facing.x === 0 && facing.y === 0) return 0;
  const angle = Math.atan2(facing.x, facing.y);
  return (Math.round(angle / (Math.PI / 4)) + 8) % 8;
}

/** 첫 칸은 idle, 나머지 세 칸은 이동 중 8fps로 반복하는 다람쥐 아틀라스 열이다. */
export function squirrelAnimationColumn(moving: boolean, renderNowMs: number): number {
  return moving ? 1 + Math.floor(renderNowMs / 125) % 3 : 0;
}

/** 다른 클라이언트에서는 완전 불투명하고 로컬이 수관 안에 있을 때만 잎을 투과시키는 material 상태를 반환한다. */
export function canopyAppearance(localInside: boolean): CanopyAppearance {
  return localInside ? { opacity: 0.28, depthWrite: false } : { opacity: 1, depthWrite: true };
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
    let action = '[F] 도토리 놓기';
    if (local.team === 'THIEF' && distanceSquared(localPosition, map.thiefBase.center) <= map.thiefBase.radius ** 2) action = '[F] 도토리 보관';
    else if (local.team === 'POLICE' && map.storages.some((storage) => distanceSquared(localPosition, storage.center) <= storage.radius ** 2)) action = '[F] 도토리 반환';
    results.push({ id: 'action-held-acorn', text: action, position: localPosition, height: 2.05 });
  } else {
    const policeCarrier = local.team === 'THIEF' ? snapshot.players
      .filter((player) => player.team === 'POLICE' && player.heldAcornId !== null)
      .map((player) => ({ player, position: renderedPositions.get(player.id) ?? player.position }))
      .filter((candidate) => distanceSquared(localPosition, candidate.position) <= gameBalance.interactionRadius ** 2)
      .sort((first, second) => distanceSquared(localPosition, first.position) - distanceSquared(localPosition, second.position))[0] : undefined;
    if (policeCarrier) results.push({ id: 'action-carried-acorn', text: '[F] 도토리 빼앗기', position: policeCarrier.position, height: 2.25 });
    else {
      const groundAcorn = snapshot.acorns.find((acorn) => acorn.location.kind === 'GROUND' && distanceSquared(localPosition, acorn.location.position) <= gameBalance.interactionRadius ** 2);
      if (groundAcorn?.location.kind === 'GROUND') results.push({ id: 'action-ground-acorn', text: '[F] 도토리 줍기', position: groundAcorn.location.position, height: 1.2 });
      if (local.team === 'THIEF') for (const storage of map.storages) {
        const available = snapshot.acorns.some((acorn) => acorn.location.kind === 'POLICE_STORAGE' && acorn.location.storageId === storage.id);
        if (available && distanceSquared(localPosition, storage.center) <= storage.radius ** 2) results.push({ id: `action-${storage.id}`, text: '[F] 도토리 훔치기', position: storage.center, height: 2.5 });
      }
    }
  }
  if (local.team === 'THIEF' && isWithinCircleReach(localPosition, map.jail, gameBalance.interactionRadius)) {
    const jailed = snapshot.players.some((player) => player.team === 'THIEF' && player.mode === 'JAILED');
    if (jailed) results.push({ id: 'action-rescue', text: '[E] 동료 구출', position: map.jail.center, height: 2.65 });
  }
  if (local.team === 'POLICE') {
    const target = snapshot.players.find((player) => player.team === 'THIEF' && player.mode !== 'JAILED' && distanceSquared(localPosition, renderedPositions.get(player.id) ?? player.position) <= gameBalance.interactionRadius ** 2);
    if (target) results.push({ id: 'action-arrest', text: '[E] 체포', position: renderedPositions.get(target.id) ?? target.position, height: 2.1 });
  }
  return results;
}

export class ThreeRenderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly world = new THREE.Group();
  private readonly entities = new THREE.Group();
  private readonly debug = new THREE.Group();
  private readonly animations = new AnimationTimeline();
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
  private playerMeshes = new Map<string, THREE.Group>();
  private readonly playerAtlasTextures = new Map<string, THREE.Texture>();
  private itemMeshes = new Map<string, THREE.Sprite>();
  private readonly disappearingItems = new Set<string>();
  private treeCanopies = new Map<string, THREE.Sprite>();
  private canopyFaded = new Map<string, boolean>();
  private stunStars = new Map<string, THREE.Group>();
  private thunderBeams = new Map<string, THREE.Line>();
  private readonly tooltipLayer = document.createElement('div');
  private readonly tooltips = new Map<string, HTMLDivElement>();
  private localPlayerId: string | null = null;
  private map: MapDefinition | null = null;
  private visible = false;
  private readonly textures = new Map<SpriteAsset, THREE.Texture>();
  private assetsPromise: Promise<void> | null = null;

  /** WebGL 표현 계층과 카메라를 구성하며 도메인 상태는 소유하지 않는다. */
  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x17281d);
    container.append(this.renderer.domElement);
    this.tooltipLayer.className = 'world-tooltips';
    container.append(this.tooltipLayer);
    this.setVisible(false);
    this.scene.add(this.world, this.entities, this.debug);
    configureTopDownCamera(this.camera);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => { if (event.code === 'Backquote' && !event.repeat) this.debug.visible = !this.debug.visible; });
    this.debug.visible = false;
    this.resize();
    void this.prepareAssets().catch((error: unknown) => console.warn('스프라이트 자산을 불러오지 못했습니다.', error));
  }

  /** 맵 ready 신호 전에 호출해 모든 클라이언트 전용 텍스처를 한 번만 preload한다. */
  prepareAssets(): Promise<void> {
    if (this.assetsPromise) return this.assetsPromise;
    const loader = new THREE.TextureLoader();
    this.assetsPromise = Promise.all(Object.entries(spriteAssetPaths).map(async ([name, path]) => {
      const texture = await loader.loadAsync(path);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.textures.set(name as SpriteAsset, texture);
    })).then(() => {
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
    for (const texture of this.playerAtlasTextures.values()) texture.dispose();
    this.playerAtlasTextures.clear(); this.playerMeshes.clear(); this.itemMeshes.clear(); this.disappearingItems.clear(); this.treeCanopies.clear(); this.canopyFaded.clear(); this.stunStars.clear(); this.thunderBeams.clear();
    this.tooltipLayer.replaceChildren(); this.tooltips.clear();
  }

  /** 권위 MapDefinition을 표현 mesh로 다시 만들며 충돌 debug는 별도 layer에 둔다. */
  buildMap(map: MapDefinition): void {
    this.map = map;
    for (const id of this.treeCanopies.keys()) this.animations.stop(`canopy:${id}`);
    this.disposeGroup(this.world); this.disposeGroup(this.debug); this.treeCanopies.clear(); this.canopyFaded.clear();
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
    this.addJail(map.jail);
    for (const storage of map.storages) this.addZone(storage.center, storage.radius, 0x315a86);
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
      const trunk = this.createSprite('trunk', tree.trunkRadius * 2.35, tree.trunkRadius * 2.35, 1.16);
      trunk.position.copy(gameToScene(tree.center, 0.7)); this.world.add(trunk);
      const canopy = this.createSprite('canopy', tree.canopyRadius * 2.25, tree.canopyRadius * 2.25, 1.4);
      canopy.position.copy(gameToScene(tree.center, 1.85));
      canopy.renderOrder = 3;
      this.world.add(canopy); this.treeCanopies.set(tree.id, canopy);
      this.canopyFaded.set(tree.id, false);
      const trunkDebug = new THREE.Mesh(new THREE.RingGeometry(tree.trunkRadius - 0.04, tree.trunkRadius + 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide }));
      trunkDebug.rotation.x = -Math.PI / 2; trunkDebug.position.copy(gameToScene(tree.center, 0.04)); this.debug.add(trunkDebug);
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
        mesh = new THREE.Group();
        const squirrelTexture = this.textureForPlayer(player.id);
        const squirrel = new THREE.Sprite(new THREE.SpriteMaterial({ map: squirrelTexture, transparent: true, depthWrite: false }));
        squirrel.name = 'squirrel';
        squirrel.scale.set(1.85, 1.85, 1);
        squirrel.position.y = 0.4;
        mesh.add(squirrel);
        const palette = teamPalette(player.team);
        const teamRing = new THREE.Mesh(new THREE.RingGeometry(0.61, 0.7, 24), new THREE.MeshBasicMaterial({ color: palette.ring, side: THREE.DoubleSide }));
        teamRing.rotation.x = -Math.PI / 2;
        teamRing.position.y = 0.04;
        mesh.add(teamRing);
        this.entities.add(mesh); this.playerMeshes.set(player.id, mesh);
      }
      const palette = teamPalette(player.team);
      ((mesh.children[1] as THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>).material).color.setHex(palette.ring);
      const interpolated = player.id === this.localPlayerId ? null : interpolate(player.id);
      const position = player.id === this.localPlayerId && localPredicted ? localPredicted : interpolated?.position ?? player.position;
      const facing = player.id === this.localPlayerId && localPredictedFacing ? localPredictedFacing : interpolated?.facing ?? player.facing;
      renderedPositions.set(player.id, position);
      mesh.position.copy(gameToScene(position, 0));
      const squirrel = mesh.children[0] as THREE.Sprite;
      this.setSquirrelFrame(squirrel, player.id, facing, player.mode === 'NORMAL' && (player.velocity.x ** 2 + player.velocity.y ** 2) > 0.01, player.mode, renderNowMs);
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
    const localPosition = this.localPlayerId ? renderedPositions.get(this.localPlayerId) : undefined;
    if (this.map) for (const tree of this.map.trees) {
      const canopy = this.treeCanopies.get(tree.id);
      if (canopy) {
        const faded = Boolean(localPosition && isInsideTreeCanopy(localPosition, tree));
        if (this.canopyFaded.get(tree.id) !== faded) this.transitionCanopy(tree.id, canopy.material, faded, renderNowMs);
      }
    }
    const items: Array<{ id: string; position: Vec2; asset: 'acorn' | 'berry'; scale: number; height: number }> = [
      ...snapshot.acorns.flatMap((acorn) => {
        if (acorn.location.kind === 'GROUND') return [{ id: acorn.id, position: acorn.location.position, asset: 'acorn' as const, scale: 0.78, height: 0.38 }];
        if (acorn.location.kind === 'POLICE_STORAGE') {
          const storageId = acorn.location.storageId;
          const storage = this.map?.storages.find((candidate) => candidate.id === storageId);
          const position = storage?.slotPositions[acorn.location.slot];
          return position ? [{ id: acorn.id, position, asset: 'acorn' as const, scale: 0.78, height: 0.38 }] : [];
        }
        if (acorn.location.kind === 'SECURED' && this.map) {
          const slot = acorn.location.slot;
          return [{ id: acorn.id, position: { x: this.map.thiefBase.center.x + (slot % 3 - 1) * 0.72, y: this.map.thiefBase.center.y + (Math.floor(slot / 3) - 1) * 0.72 }, asset: 'acorn' as const, scale: 0.78, height: 0.38 }];
        }
        if (acorn.location.kind === 'CARRIED') {
          const carrierId = acorn.location.carrierId;
          const carrier = snapshot.players.find((player) => player.id === carrierId);
          const position = renderedPositions.get(carrierId) ?? carrier?.position;
          return position ? [{ id: acorn.id, position, asset: 'acorn' as const, scale: 0.72, height: 1.25 }] : [];
        }
        return [];
      }),
      ...snapshot.berries.map((berry) => ({ id: berry.id, position: berry.position, asset: 'berry' as const, scale: 0.82, height: 0.43 }))
    ];
    const activeItems = new Set<string>(items.map((item) => item.id));
    for (const item of items) {
      let mesh = this.itemMeshes.get(item.id);
      const created = !mesh;
      if (!mesh) {
        mesh = this.createSprite(item.asset, 0.01, 0.01, 0.5);
        this.entities.add(mesh); this.itemMeshes.set(item.id, mesh);
        this.animations.tweenNumber(`item-in:${item.id}`, 0.01, item.scale, renderNowMs, (value) => mesh!.scale.set(value, value, 1), { durationMs: 150, easing: animationEasing.Back.Out });
      }
      if (this.disappearingItems.delete(item.id)) {
        this.animations.stop(`item-out:${item.id}`);
        mesh.material.opacity = 1;
      }
      if (!created) mesh.scale.set(item.scale, item.scale, 1);
      mesh.position.copy(gameToScene(item.position, item.height)); mesh.visible = true;
    }
    for (const [id, mesh] of this.itemMeshes) if (!activeItems.has(id) && !this.disappearingItems.has(id)) this.transitionItemOut(id, mesh, renderNowMs);
    this.updateThunderBeams(snapshot);
    this.updateTooltips(snapshot, renderedPositions);
  }

  /** 현재 camera와 실제 canvas rect를 사용해 조준용 포인터를 게임 좌표로 변환한다. */
  clientToGame(clientX: number, clientY: number): Vec2 | null {
    return clientPointToGame(this.camera, this.renderer.domElement.getBoundingClientRect(), clientX, clientY);
  }

  /** 현재 scene graph를 한 frame 그리며 게임 상태를 변경하지 않는다. */
  /** 공유 텍스처를 사용하는 탑뷰 sprite를 만들어 각 world prefab의 높이와 render 순서를 통일한다. */
  private createSprite(asset: SpriteAsset, width: number, height: number, renderOrder: number): THREE.Sprite {
    const material = new THREE.SpriteMaterial({ map: this.textures.get(asset) ?? null, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(width, height, 1);
    sprite.renderOrder = renderOrder;
    return sprite;
  }

  /** 아틀라스 UV는 플레이어별 텍스처 clone에만 기록해 원격 다람쥐의 프레임이 서로 덮어쓰지 않게 한다. */
  private textureForPlayer(playerId: string): THREE.Texture {
    const existing = this.playerAtlasTextures.get(playerId);
    if (existing) return existing;
    const texture = (this.textures.get('squirrel') ?? new THREE.Texture()).clone();
    texture.repeat.set(1 / 4, 1 / 8);
    texture.offset.set(0, 1 - 1 / 8);
    texture.needsUpdate = true;
    this.playerAtlasTextures.set(playerId, texture);
    return texture;
  }

  /** 권위 facing·속도만으로 다람쥐의 8방향 행과 idle/걷기 열을 선택하며 게임 상태는 바꾸지 않는다. */
  private setSquirrelFrame(sprite: THREE.Sprite, playerId: string, facing: Vec2, moving: boolean, mode: string, renderNowMs: number): void {
    const texture = this.textureForPlayer(playerId);
    const column = squirrelAnimationColumn(moving && mode === 'NORMAL', renderNowMs);
    texture.offset.set(column / 4, 1 - (squirrelFacingRow(facing) + 1) / 8);
    texture.needsUpdate = true;
    if (sprite.material.map !== texture) sprite.material.map = texture;
  }

  /** 권위 AABB를 바꾸지 않고, 긴 축을 따라 top-down 울타리 패널과 양 끝 돌무리만 배치한다. */
  private addFenceCollider(center: Vec2, width: number, height: number): void {
    const horizontal = width >= height;
    const length = horizontal ? width : height;
    const thickness = horizontal ? height : width;
    const panels = Math.max(1, Math.ceil(length / 2.8));
    const panelLength = length / panels + 0.1;
    for (let index = 0; index < panels; index += 1) {
      const offset = -length / 2 + panelLength * (index + 0.5);
      const position = horizontal ? { x: center.x + offset, y: center.y } : { x: center.x, y: center.y + offset };
      const fence = this.createSprite('fence', horizontal ? panelLength : Math.max(thickness, 0.72), horizontal ? Math.max(thickness, 0.72) : panelLength, 1.18);
      if (!horizontal) fence.material.rotation = Math.PI / 2;
      fence.position.copy(gameToScene(position, 0.32));
      this.world.add(fence);
    }
    for (const sign of [-1, 1]) {
      const position = horizontal ? { x: center.x + sign * length / 2, y: center.y } : { x: center.x, y: center.y + sign * length / 2 };
      const rock = this.createSprite('rock', Math.max(0.72, thickness * 1.35), Math.max(0.72, thickness * 1.35), 1.2);
      rock.position.copy(gameToScene(position, 0.36));
      this.world.add(rock);
    }
  }

  /** item이 snapshot에서 사라질 때 짧은 축소·페이드 후 mesh를 제거해 다음 등장 animation과 분리한다. */
  private transitionItemOut(id: string, mesh: THREE.Sprite, renderNowMs: number): void {
    this.disappearingItems.add(id);
    const startScale = mesh.scale.x;
    this.animations.tweenNumber(`item-out:${id}`, 0, 1, renderNowMs, (progress) => {
      mesh.scale.setScalar(Math.max(0.01, startScale * (1 - progress)));
      mesh.material.opacity = 1 - progress;
    }, {
      durationMs: 120,
      easing: animationEasing.Quadratic.In,
      onComplete: () => {
        this.entities.remove(mesh);
        mesh.material.dispose();
        this.itemMeshes.delete(id);
        this.disappearingItems.delete(id);
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

  /** 원형 목표 zone을 넓은 저상 prefab으로 표시해 확대 월드에서도 거점을 식별하게 한다. */
  private addZone(center: Vec2, radius: number, color: number): void {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.24, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78 }));
    mesh.position.copy(gameToScene(center, 0.12));
    this.world.add(mesh);
  }
  /** 감옥의 렌더 footprint와 권위 원형 충돌 반지름을 일치시키고 테두리·창살로 통과 불가 경계를 표현한다. */
  private addJail(jail: JailDefinition): void {
    this.addZone(jail.center, jail.radius, 0x656d78);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(jail.radius - 0.13, 0.13, 8, 48), new THREE.MeshBasicMaterial({ color: 0xc2cad2 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(gameToScene(jail.center, 0.72));
    this.world.add(ring);
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * Math.PI * 2;
      const position = { x: jail.center.x + Math.cos(angle) * (jail.radius - 0.13), y: jail.center.y + Math.sin(angle) * (jail.radius - 0.13) };
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1.25, 8), new THREE.MeshBasicMaterial({ color: 0xaeb8c2 }));
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
  private transitionCanopy(treeId: string, material: THREE.SpriteMaterial, faded: boolean, renderNowMs: number): void {
    this.canopyFaded.set(treeId, faded);
    const appearance = canopyAppearance(faded);
    if (faded) material.depthWrite = false;
    this.animations.tweenNumber(`canopy:${treeId}`, material.opacity, appearance.opacity, renderNowMs, (value) => { material.opacity = value; }, {
      durationMs: faded ? 140 : 190,
      easing: animationEasing.Quadratic.Out,
      onComplete: () => { material.depthWrite = appearance.depthWrite; }
    });
  }

  /** 서버가 한 tick에 확정한 hitscan 시작·끝을 짧은 발광 선으로 표시한다. */
  private updateThunderBeams(snapshot: WorldSnapshot): void {
    const active = new Set<string>(snapshot.thunderEffects.map((effect) => effect.id));
    for (const effect of snapshot.thunderEffects) {
      let beam = this.thunderBeams.get(effect.id);
      const points = [gameToScene(effect.start, 0.62), gameToScene(effect.end, 0.62)];
      if (!beam) {
        beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: effect.hitPlayerId ? 0xfff176 : 0x8cecff, transparent: true, opacity: 0.92 }));
        this.entities.add(beam); this.thunderBeams.set(effect.id, beam);
      } else beam.geometry.setFromPoints(points);
      beam.visible = true;
    }
    for (const [id, beam] of this.thunderBeams) if (!active.has(id)) {
      this.entities.remove(beam);
      beam.geometry.dispose();
      (beam.material as THREE.Material).dispose();
      this.thunderBeams.delete(id);
    }
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
