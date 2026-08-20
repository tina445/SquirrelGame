import * as THREE from 'three';
import type { MapDefinition, WorldSnapshot, Vec2 } from '@squirrel-heist/shared';

export class ThreeRenderer {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly world = new THREE.Group();
  private readonly entities = new THREE.Group();
  private readonly debug = new THREE.Group();
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
  private playerMeshes = new Map<string, THREE.Mesh>();
  private itemMeshes = new Map<string, THREE.Mesh>();
  private localPlayerId: string | null = null;

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x17281d);
    container.append(this.renderer.domElement);
    this.scene.add(this.world, this.entities, this.debug);
    this.camera.position.set(0, 20, 0);
    this.camera.lookAt(0, 0, 0);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (event) => { if (event.code === 'KeyD') this.debug.visible = !this.debug.visible; });
    this.debug.visible = false;
  }

  setLocalPlayer(id: string): void { this.localPlayerId = id; }

  buildMap(map: MapDefinition): void {
    this.world.clear(); this.debug.clear();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.width, map.height), new THREE.MeshBasicMaterial({ color: 0x355e3b }));
    ground.rotation.x = -Math.PI / 2; this.world.add(ground);
    this.addZone(map.thiefBase.center, map.thiefBase.radius, 0xb87938);
    this.addZone(map.jail.center, map.jail.radius, 0x6f7580);
    for (const storage of map.storages) this.addZone(storage.center, storage.radius, 0x315a86);
    for (const box of map.staticColliders) {
      const width = box.max.x - box.min.x; const height = box.max.y - box.min.y;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1.5, height), new THREE.MeshBasicMaterial({ color: 0x244526 }));
      mesh.position.set((box.min.x + box.max.x) / 2, 0.75, (box.min.y + box.max.y) / 2); this.world.add(mesh);
      const helper = new THREE.BoxHelper(mesh, 0xff5544); this.debug.add(helper);
    }
    for (const point of map.berrySpawnPoints) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 12), new THREE.MeshBasicMaterial({ color: 0xda5b8a, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.set(point.x, 0.03, point.y); this.debug.add(marker);
    }
  }

  update(snapshot: WorldSnapshot, localPredicted: Vec2 | null, interpolate: (id: string) => Vec2 | null): void {
    const activePlayers = new Set<string>(snapshot.players.map((player) => player.id));
    for (const player of snapshot.players) {
      let mesh = this.playerMeshes.get(player.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.75, 16), new THREE.MeshBasicMaterial({ color: player.team === 'THIEF' ? 0xf2a65a : 0x5ca8e6 }));
        this.entities.add(mesh); this.playerMeshes.set(player.id, mesh);
      }
      const position = player.id === this.localPlayerId && localPredicted ? localPredicted : interpolate(player.id) ?? player.position;
      mesh.position.set(position.x, 0.4, position.y);
      mesh.scale.y = player.mode === 'STUNNED' ? 0.55 : 1;
      mesh.visible = true;
      if (player.id === this.localPlayerId) this.follow(position);
    }
    for (const [id, mesh] of this.playerMeshes) if (!activePlayers.has(id)) mesh.visible = false;
    const items = [
      ...snapshot.acorns.flatMap((acorn) => acorn.location.kind === 'GROUND' ? [{ id: acorn.id, position: acorn.location.position, color: 0xc98b3c, radius: 0.23 }] : []),
      ...snapshot.berries.map((berry) => ({ id: berry.id, position: berry.position, color: 0xd94c78, radius: 0.28 })),
      ...snapshot.projectiles.map((projectile) => ({ id: projectile.id, position: projectile.position, color: 0xf6e05e, radius: 0.16 }))
    ];
    const activeItems = new Set<string>(items.map((item) => item.id));
    for (const item of items) {
      let mesh = this.itemMeshes.get(item.id);
      if (!mesh) { mesh = new THREE.Mesh(new THREE.SphereGeometry(item.radius, 12, 8), new THREE.MeshBasicMaterial({ color: item.color })); this.entities.add(mesh); this.itemMeshes.set(item.id, mesh); }
      mesh.position.set(item.position.x, 0.35, item.position.y); mesh.visible = true;
    }
    for (const [id, mesh] of this.itemMeshes) if (!activeItems.has(id)) mesh.visible = false;
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
  private addZone(center: Vec2, radius: number, color: number): void { const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.set(center.x, 0.02, center.y); this.world.add(mesh); }
  private follow(position: Vec2): void { this.camera.position.x += (position.x - this.camera.position.x) * 0.08; this.camera.position.z += (position.y - this.camera.position.z) * 0.08; }
  private resize(): void { const aspect = innerWidth / innerHeight; const view = 12; this.camera.left = -view * aspect; this.camera.right = view * aspect; this.camera.top = view; this.camera.bottom = -view; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
