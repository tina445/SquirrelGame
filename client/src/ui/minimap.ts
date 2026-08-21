import type { Aabb, AcornState, MapDefinition, PlayerId, Vec2, WorldSnapshot } from '@squirrel-heist/shared';

export interface MiniMapPoint { x: number; y: number }

/** 게임 +Y가 미니맵 위쪽이 되도록 월드 좌표를 canvas 내부 좌표로 축소 투영한다. */
export function worldToMinimap(point: Vec2, bounds: Aabb, width: number, height: number, padding = 10): MiniMapPoint {
  const worldWidth = Math.max(1, bounds.max.x - bounds.min.x);
  const worldHeight = Math.max(1, bounds.max.y - bounds.min.y);
  const scale = Math.min(Math.max(1, width - padding * 2) / worldWidth, Math.max(1, height - padding * 2) / worldHeight);
  const offsetX = (width - worldWidth * scale) / 2;
  const offsetY = (height - worldHeight * scale) / 2;
  return {
    x: offsetX + (point.x - bounds.min.x) * scale,
    y: height - offsetY - (point.y - bounds.min.y) * scale
  };
}

/** 권위 MapDefinition과 snapshot을 목표·도토리·아군 중심의 상시 미니맵 표현으로 투영한다. */
export class MiniMap {
  private readonly context: CanvasRenderingContext2D | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d');
  }

  update(snapshot: WorldSnapshot, map: MapDefinition, localId: PlayerId): void {
    const context = this.context;
    if (!context) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const project = (point: Vec2): MiniMapPoint => worldToMinimap(point, map.bounds, width, height, 18);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#07120ddd';
    context.fillRect(0, 0, width, height);

    context.beginPath();
    this.tracePolygon(context, map.playableArea, project);
    for (const hole of map.playableHoles) this.tracePolygon(context, hole, project);
    context.fillStyle = '#315b3d';
    context.fill('evenodd');
    context.strokeStyle = '#8db59a';
    context.lineWidth = 3;
    context.stroke();

    context.fillStyle = '#1c3324';
    for (const box of map.staticColliders) {
      const topLeft = project({ x: box.min.x, y: box.max.y });
      const bottomRight = project({ x: box.max.x, y: box.min.y });
      context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    }
    context.fillStyle = '#24472c';
    for (const tree of map.trees) this.drawCircle(context, project(tree.center), 3.5);

    this.drawLandmark(context, project(map.thiefBase.center), 12, '#e89249', 'B');
    this.drawLandmark(context, project(map.jail.center), 12, '#c6ccd2', 'J');
    map.storages.forEach((storage, index) => this.drawLandmark(context, project(storage.center), 11, '#64a9ec', String.fromCharCode(65 + index)));

    for (const acorn of snapshot.acorns) {
      const position = this.acornPosition(acorn, snapshot, map);
      if (!position) continue;
      const point = project(position);
      this.drawCircle(context, point, 4.2, '#ffd267');
      context.strokeStyle = '#6b421b';
      context.lineWidth = 1.5;
      context.stroke();
    }
    for (const berry of snapshot.berries) this.drawCircle(context, project(berry.position), 4.5, '#f26f9d');

    const local = snapshot.players.find((player) => player.id === localId);
    if (!local) return;
    for (const player of snapshot.players) {
      if (player.team !== local.team) continue;
      const point = project(player.position);
      if (player.id === localId) {
        context.save();
        context.translate(point.x, point.y);
        context.rotate(Math.atan2(-player.facing.y, player.facing.x));
        context.beginPath();
        context.moveTo(10, 0);
        context.lineTo(-7, -7);
        context.lineTo(-4, 0);
        context.lineTo(-7, 7);
        context.closePath();
        context.fillStyle = '#fff8d8';
        context.fill();
        context.strokeStyle = '#172319';
        context.lineWidth = 2;
        context.stroke();
        context.restore();
      } else {
        this.drawCircle(context, point, 6, player.team === 'POLICE' ? '#77bfff' : '#ffad67');
        if (player.mode === 'JAILED') {
          context.strokeStyle = '#ffffff';
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(point.x - 5, point.y - 5); context.lineTo(point.x + 5, point.y + 5);
          context.moveTo(point.x + 5, point.y - 5); context.lineTo(point.x - 5, point.y + 5);
          context.stroke();
        }
      }
    }
  }

  private acornPosition(acorn: AcornState, snapshot: WorldSnapshot, map: MapDefinition): Vec2 | null {
    const location = acorn.location;
    if (location.kind === 'GROUND') return location.position;
    if (location.kind === 'POLICE_STORAGE') return map.storages.find((storage) => storage.id === location.storageId)?.slotPositions[location.slot] ?? null;
    if (location.kind === 'SECURED') return {
      x: map.thiefBase.center.x + (location.slot % 3 - 1) * 0.72,
      y: map.thiefBase.center.y + (Math.floor(location.slot / 3) - 1) * 0.72
    };
    return snapshot.players.find((player) => player.id === location.carrierId)?.position ?? null;
  }

  private tracePolygon(context: CanvasRenderingContext2D, polygon: Vec2[], project: (point: Vec2) => MiniMapPoint): void {
    polygon.forEach((point, index) => {
      const projected = project(point);
      if (index === 0) context.moveTo(projected.x, projected.y);
      else context.lineTo(projected.x, projected.y);
    });
    context.closePath();
  }

  private drawLandmark(context: CanvasRenderingContext2D, point: MiniMapPoint, radius: number, color: string, label: string): void {
    this.drawCircle(context, point, radius, color);
    context.fillStyle = '#102018';
    context.font = '900 15px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, point.x, point.y + 0.5);
  }

  private drawCircle(context: CanvasRenderingContext2D, point: MiniMapPoint, radius: number, color?: string): void {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (color) context.fillStyle = color;
    context.fill();
  }
}
