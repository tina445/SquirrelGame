import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clientPointToGame, configureTopDownCamera, gameToScene, isInsideTreeCanopy } from '../src/rendering/threeRenderer.js';

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
  });
});
