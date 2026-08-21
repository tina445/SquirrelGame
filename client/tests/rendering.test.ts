import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateMap, type AcornId, type PlayerId, type PlayerSnapshot, type WorldSnapshot } from '@squirrel-heist/shared';
import { AnimationTimeline, animationEasing } from '../src/animation/animationTimeline.js';
import { canopyAppearance, clientPointToGame, configureTopDownCamera, contextualTooltips, gameToScene, isInsideTreeCanopy, stunIndicatorVisible, teamPalette } from '../src/rendering/threeRenderer.js';
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
    expect(tooltips.map((tooltip) => tooltip.text)).toContain('[F] 도토리 줍기');
    const rescue = tooltips.find((tooltip) => tooltip.id === 'action-rescue');
    expect(rescue?.text).toBe('[E] 동료 구출');
    expect(rescue?.position).toEqual(map.jail.center);
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
