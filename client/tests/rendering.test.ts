import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateMap, type AcornId, type PlayerId, type PlayerSnapshot, type WorldSnapshot } from '@squirrel-heist/shared';
import { AnimationTimeline, animationEasing } from '../src/animation/animationTimeline.js';
import { canopyAppearance, clientPointToGame, configureTopDownCamera, contextualTooltips, finishCanopyOpacityTween, gameToScene, isInsideTreeCanopy, prepareCanopyOpacityTween, stunIndicatorVisible, teamPalette, thunderArcPoints } from '../src/rendering/threeRenderer.js';
import { createLayeredMotionState, facingYaw, modelAssetManifest, modelItemScale, nearestEquivalentAngle, playerVisualSize, sampleLayeredMotion, simulateAcornPile } from '../src/rendering/modelPresentation.js';
import { createTerrainDecoration, dirtPathRenderPoints, dirtPathRibbonGeometry, terrainChunkCells, terrainChunkSize, terrainScatterPositions } from '../src/rendering/terrainChunks.js';
import { interpolateFacing } from '../src/prediction/snapshotBuffer.js';
import { worldToMinimap } from '../src/ui/minimap.js';

describe('top-down camera orientation', () => {
  it('projects game +X right and game +Y toward the top of the screen', () => {
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
    configureTopDownCamera(camera);
    const east = gameToScene({ x: 1, y: 0 }).project(camera);
    const west = gameToScene({ x: -1, y: 0 }).project(camera);
    const north = gameToScene({ x: 0, y: 1 }).project(camera);
    const south = gameToScene({ x: 0, y: -1 }).project(camera);
    expect(east.x).toBeGreaterThan(west.x);
    expect(north.y).toBeGreaterThan(south.y);
  });

  it('round-trips a client pointer through a moved camera and non-square viewport', () => {
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
    configureTopDownCamera(camera);
    camera.position.x = 5;
    camera.position.z = -7;
    camera.updateMatrixWorld();
    const rect = { left: 100, top: 50, width: 960, height: 540 };
    const expected = { x: 9, y: 3 };
    const projected = gameToScene(expected).project(camera);
    const clientX = rect.left + (projected.x + 1) * 0.5 * rect.width;
    const clientY = rect.top + (1 - projected.y) * 0.5 * rect.height;
    const actual = clientPointToGame(camera, rect, clientX, clientY);
    expect(actual?.x).toBeCloseTo(expected.x);
    expect(actual?.y).toBeCloseTo(expected.y);
  });

  it('rejects pointer coordinates outside the canvas', () => {
    const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 100);
    configureTopDownCamera(camera);
    expect(clientPointToGame(camera, { left: 10, top: 20, width: 100, height: 80 }, 9, 40)).toBeNull();
  });

  it('fades a canopy only when the local player circle enters its outer radius', () => {
    const tree = { id: 'tree', center: { x: 2, y: 3 }, trunkRadius: 0.8, canopyRadius: 2.4 };
    expect(isInsideTreeCanopy({ x: 4.7, y: 3 }, tree)).toBe(true);
    expect(isInsideTreeCanopy({ x: 5, y: 3 }, tree)).toBe(false);
    expect(canopyAppearance(false)).toEqual({ opacity: 1, depthWrite: true });
    expect(canopyAppearance(true)).toEqual({ opacity: 0.28, depthWrite: false });
  });

  it('switches opaque GLB canopy materials into a transparent tween path and restores them', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x5e9d4b });
    prepareCanopyOpacityTween([material]);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.opacity = 0.28;
    finishCanopyOpacityTween([material], true);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.opacity = 1;
    finishCanopyOpacityTween([material], false);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    material.dispose();
  });

  it('uses distinct police and thief palettes after late role assignment', () => {
    expect(teamPalette('POLICE')).not.toEqual(teamPalette('THIEF'));
    expect(teamPalette(null)).not.toEqual(teamPalette('POLICE'));
  });

  it('anchors a multi-prisoner rescue tooltip to the jail prefab instead of a jailed player', () => {
    const map = generateMap('tooltip-test').map;
    const local = { id: 'local' as PlayerId, displayName: 'local', team: 'THIEF', position: map.jail.escapePoints[0], mode: 'NORMAL', heldAcornId: null } as PlayerSnapshot;
    const jailed = { id: 'jailed' as PlayerId, displayName: 'jailed', team: 'THIEF', position: map.jail.slots[0], mode: 'JAILED', heldAcornId: null } as PlayerSnapshot;
    const jailedSecond = { ...jailed, id: 'jailed-second' as PlayerId, position: map.jail.slots[1] } as PlayerSnapshot;
    const snapshot = {
      phase: 'PLAYING', players: [local, jailed, jailedSecond],
      acorns: [{ id: 'ground' as AcornId, location: { kind: 'GROUND', position: local.position } }],
      berries: [], thunderEffects: [], interactions: []
    } as unknown as WorldSnapshot;
    const tooltips = contextualTooltips(snapshot, map, local.id, new Map([[local.id, local.position], [jailed.id, jailed.position], [jailedSecond.id, jailedSecond.position]]));
    expect(tooltips.map((tooltip) => tooltip.text)).toContain('감옥');
    expect(tooltips.map((tooltip) => tooltip.text)).toContain('[LShift] 도토리 줍기');
    const rescue = tooltips.find((tooltip) => tooltip.id === 'action-rescue');
    expect(rescue?.text).toBe('[Space] 동료 구출');
    expect(rescue?.position).toEqual(map.jail.center);
  });

  it('offers the thief a carried-acorn steal action before other LShift interactions', () => {
    const map = generateMap('carried-acorn-tooltip').map;
    const thief = { id: 'thief' as PlayerId, displayName: 'thief', team: 'THIEF', position: { ...map.thiefBase.center }, mode: 'NORMAL', heldAcornId: null } as PlayerSnapshot;
    const police = { id: 'police' as PlayerId, displayName: 'police', team: 'POLICE', position: { x: thief.position.x + 0.6, y: thief.position.y }, mode: 'NORMAL', heldAcornId: 'carried' as AcornId } as PlayerSnapshot;
    const snapshot = {
      phase: 'PLAYING', players: [thief, police], acorns: [{ id: 'carried' as AcornId, location: { kind: 'CARRIED', carrierId: police.id } }],
      berries: [], thunderEffects: [], interactions: []
    } as unknown as WorldSnapshot;
    const tooltips = contextualTooltips(snapshot, map, thief.id, new Map([[thief.id, thief.position], [police.id, police.position]]));
    expect(tooltips.find((tooltip) => tooltip.id === 'action-carried-acorn')).toMatchObject({ text: '[LShift] 도토리 빼앗기', position: police.position });
  });

  it('projects east and north consistently onto the minimap', () => {
    const bounds = { min: { x: -128, y: -96 }, max: { x: 128, y: 96 } };
    const northWest = worldToMinimap({ x: -128, y: 96 }, bounds, 440, 330);
    const southEast = worldToMinimap({ x: 128, y: -96 }, bounds, 440, 330);
    expect(northWest.x).toBeCloseTo(13.33, 1); expect(northWest.y).toBeCloseTo(10);
    expect(southEast.x).toBeCloseTo(426.67, 1); expect(southEast.y).toBeCloseTo(320);
    const center = worldToMinimap({ x: 0, y: 0 }, bounds, 440, 330);
    expect(center).toEqual({ x: 220, y: 165 });
  });

  it('shows the star orbit only while a squirrel is stunned', () => {
    expect(stunIndicatorVisible('STUNNED')).toBe(true);
    expect(stunIndicatorVisible('NORMAL')).toBe(false);
  });

  it('keeps server-authoritative thunder endpoints while giving the rendered bolt a blue zigzag arc', () => {
    const arc = thunderArcPoints({ x: -2, y: 1 }, { x: 7, y: 1 }, 0.8);
    expect(arc[0]).toEqual({ x: -2, y: 1 });
    expect(arc.at(-1)).toEqual({ x: 7, y: 1 });
    expect(arc.some((point) => Math.abs(point.y - 1) > 0.01)).toBe(true);
  });

  it('uses only the low-poly GLB assets and keeps field items below the player footprint', () => {
    expect(modelAssetManifest).toEqual({ squirrel: '/assets/models/low-poly/squirrel.glb', forest: '/assets/models/low-poly/forest-props.glb' });
    expect(modelItemScale).toEqual({ fieldAcorn: 1.55, storedAcorn: 1.9, carriedAcorn: 1.05, berry: 0.95 });
    expect(playerVisualSize).toBe(2.8);
    expect(modelItemScale.fieldAcorn).toBeLessThan(playerVisualSize);
    expect(modelItemScale.berry).toBeLessThan(playerVisualSize);
  });

  it('derives deterministic 10×10 terrain chunks only inside the playable field', () => {
    const map = generateMap('terrain-chunks').map;
    const first = terrainChunkCells(map);
    const repeated = terrainChunkCells(map);
    expect(terrainChunkSize).toBe(10);
    expect(first).toEqual(repeated);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((chunk) => Number.isInteger((chunk.center.x - 5) / terrainChunkSize) && Number.isInteger((chunk.center.y - 5) / terrainChunkSize))).toBe(true);
  });

  it('renders grass, dirt paths, and pebbles as a presentation-only terrain layer', () => {
    const group = createTerrainDecoration(generateMap('terrain-visuals').map);
    const names: string[] = [];
    group.traverse((node) => names.push(node.name));
    expect(names.some((name) => name.startsWith('terrain-chunk:'))).toBe(true);
    expect(names).toContain('terrain-grass-blades');
    expect(names).toContain('terrain-pebbles');
    expect(names).toContain('terrain-dirt-path');
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => material.dispose());
    });
  });

  it('spreads decoration across a chunk and rounds multi-point dirt paths', () => {
    const cell = { column: 2, row: 3, center: { x: 0, y: 0 }, tone: 1 };
    const positions = terrainScatterPositions('map-hash', cell, 'grass', 12, 4.35);
    expect(Math.max(...positions.map((position) => position.x)) - Math.min(...positions.map((position) => position.x))).toBeGreaterThan(5);
    expect(Math.max(...positions.map((position) => position.y)) - Math.min(...positions.map((position) => position.y))).toBeGreaterThan(5);
    const road = dirtPathRenderPoints([{ x: -8, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 8 }]);
    expect(road).toHaveLength(13);
    expect(road[0]).toEqual({ x: -8, y: 0 });
    expect(road.at(-1)).toEqual({ x: 0, y: 8 });
    expect(road.some((point) => point.x > -8 && point.x < 0 && point.y < 0)).toBe(true);
    const ribbon = dirtPathRibbonGeometry(road, 2.15);
    expect(ribbon?.getAttribute('position').count).toBeGreaterThan(10);
    ribbon?.dispose();
  });

  it('rotates a north-authored layered squirrel continuously and across the shortest angle arc', () => {
    expect(facingYaw({ x: 0, y: 1 })).toBeCloseTo(0);
    expect(facingYaw({ x: 1, y: 0 })).toBeCloseTo(-Math.PI / 2);
    const nearPositivePi = Math.PI - 0.05;
    const nearNegativePi = -Math.PI + 0.05;
    expect(nearestEquivalentAngle(nearPositivePi, nearNegativePi) - nearPositivePi).toBeCloseTo(0.1);
    const interpolated = interpolateFacing({ x: Math.sin(nearPositivePi), y: Math.cos(nearPositivePi) }, { x: Math.sin(nearNegativePi), y: Math.cos(nearNegativePi) }, 0.5);
    expect(Math.abs(Math.atan2(interpolated.x, interpolated.y))).toBeCloseTo(Math.PI);
  });

  it('advances four gait frames by rendered distance and applies stop and teleport reset rules', () => {
    const state = createLayeredMotionState();
    expect(sampleLayeredMotion(state, { x: 0, y: 0 }, 0, true).frame).toBe(0);
    expect(sampleLayeredMotion(state, { x: 0.02, y: 0 }, 100, true)).toMatchObject({ frame: 1, moving: true });
    expect(sampleLayeredMotion(state, { x: 0.18, y: 0 }, 200, true).frame).toBe(2);
    expect(sampleLayeredMotion(state, { x: 0.18, y: 0 }, 240, true).moving).toBe(true);
    expect(sampleLayeredMotion(state, { x: 0.18, y: 0 }, 330, true).moving).toBe(false);
    expect(sampleLayeredMotion(state, { x: 3, y: 0 }, 350, true)).toMatchObject({ frame: 0, moving: false, teleported: true });
    expect(sampleLayeredMotion(state, { x: 3.1, y: 0 }, 400, false).frame).toBe(0);
  });

  it('settles stored acorns into a deterministic, non-grid pseudo-physics pile', () => {
    const ids = ['acorn-1', 'acorn-2', 'acorn-3', 'acorn-4', 'acorn-5'];
    const first = simulateAcornPile('map-hash', 'thief-base', ids, 1.15);
    const repeated = simulateAcornPile('map-hash', 'thief-base', ids, 1.15);
    expect([...repeated.entries()]).toEqual([...first.entries()]);
    const poses = [...first.values()];
    expect(poses.every((pose) => Math.hypot(pose.offset.x, pose.offset.y) <= 1.15)).toBe(true);
    expect(new Set(poses.map((pose) => pose.heightOffset)).size).toBeGreaterThan(1);
    expect(poses.some((pose) => pose.tiltX !== 0 || pose.tiltZ !== 0)).toBe(true);
  });

  it('updates and replaces keyed render tweens from one deterministic frame clock', () => {
    const timeline = new AnimationTimeline();
    let value = -1;
    timeline.tweenNumber('canopy', 0, 10, 1_000, (next) => { value = next; }, { durationMs: 100, easing: animationEasing.Linear.None });
    timeline.update(1_050);
    expect(value).toBeCloseTo(5);
    timeline.tweenNumber('canopy', value, 20, 1_050, (next) => { value = next; }, { durationMs: 100, easing: animationEasing.Linear.None });
    timeline.update(1_100);
    expect(value).toBeCloseTo(12.5);
    timeline.clear();
    timeline.update(1_150);
    expect(value).toBeCloseTo(12.5);
  });
});
