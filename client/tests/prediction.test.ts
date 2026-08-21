import { describe, expect, it } from 'vitest';
import { gameBalance, generateMap, type InputCommand, type PlayerId, type PlayerSnapshot, type WorldSnapshot } from '@squirrel-heist/shared';
import { LocalPrediction } from '../src/prediction/localPrediction.js';
import { SnapshotBuffer } from '../src/prediction/snapshotBuffer.js';

const remote = (serverTick: number, serverTimeMs: number, x: number, mode: PlayerSnapshot['mode'] = 'NORMAL'): WorldSnapshot => ({
  serverTick, serverTimeMs, ackInputSequence: -1, phase: 'PLAYING', remainingMs: 1_000, hostPlayerId: null,
  players: [{ id: 'remote' as PlayerId, displayName: 'remote', team: 'THIEF', position: { x, y: 0 }, velocity: { x: 10, y: 0 }, facing: { x: 1, y: 0 }, mode,
    rolePreference: 'THIEF', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0, jailedAtMs: null, disconnectedAtMs: null, assetsReady: true, ready: true, lastProcessedInputSequence: 0 }],
  acorns: [], berries: [], thunderEffects: [], interactions: [], thiefSecuredCount: 0
});

describe('client prediction and reconciliation', () => {
  it('tracks configuration explicitly even when the authoritative position is the origin', () => {
    const prediction = new LocalPrediction();
    expect(prediction.isConfigured).toBe(false);

    prediction.configure(generateMap('origin-prediction').map, { x: 0, y: 0 });

    expect(prediction.isConfigured).toBe(true);
    expect(prediction.position).toEqual({ x: 0, y: 0 });
  });

  it('predicts immediately then replays unacknowledged input', () => {
    const map = generateMap('prediction').map;
    const prediction = new LocalPrediction();
    prediction.configure(map, { x: -12, y: 0 });
    const input: InputCommand = { sequence: 1, clientTick: 1, moveX: 0, moveY: 1, aimX: 1, aimY: 0, buttons: 0 };
    prediction.apply(input, 0.05, false);
    expect(prediction.position.x).toBeGreaterThan(-12);
    const player = { id: 'local', position: { x: -12, y: 0 }, lastProcessedInputSequence: 0, heldAcornId: null } as PlayerSnapshot;
    prediction.reconcile(player);
    expect(prediction.position.x).toBeGreaterThan(-12);
  });

  it('advances the local visual position on 60fps frames while commands remain at 20Hz', () => {
    const prediction = new LocalPrediction();
    prediction.configure(generateMap('visual-prediction').map, { x: -12, y: 0 });
    const samples = Array.from({ length: 4 }, () => prediction.advanceVisual({ x: 0, y: 1 }, { x: 1, y: 0 }, 1 / 60, false, true).x);
    expect(samples[1]!).toBeGreaterThan(samples[0]!);
    expect(samples[2]!).toBeGreaterThan(samples[1]!);
    expect(samples[3]!).toBeGreaterThan(samples[2]!);
  });

  it('predicts the same impassable jail footprint as the authoritative server', () => {
    const map = generateMap('prediction-jail').map;
    const prediction = new LocalPrediction();
    const start = { x: map.jail.center.x - map.jail.radius - gameBalance.playerRadius - 0.02, y: map.jail.center.y };
    prediction.configure(map, start);
    prediction.apply({ sequence: 1, clientTick: 1, moveX: 0, moveY: 1, aimX: 1, aimY: 0, buttons: 0 }, 0.05, false);
    expect(prediction.position.x).toBe(start.x);
  });

  it('advances remote interpolation on 60fps frames between 20Hz snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    buffer.push(remote(2, 50, 0.5), 150);
    const first = buffer.samplePlayer('remote', 150, 50);
    const nextFrame = buffer.samplePlayer('remote', 166, 50);
    expect(first?.position.x).toBeCloseTo(0);
    expect(nextFrame?.position.x).toBeCloseTo(0.16);
  });

  it('caps packet-gap extrapolation and snaps jail teleports', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    buffer.push(remote(2, 50, 0.5), 150);
    expect(buffer.samplePlayer('remote', 400, 0)?.position.x).toBeCloseTo(1.5);
    buffer.push(remote(3, 100, 12, 'JAILED'), 200);
    expect(buffer.samplePlayer('remote', 200, 0)?.position.x).toBeCloseTo(12);
  });

  it('does not rewind the render clock when a snapshot arrives late', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    expect(buffer.samplePlayer('remote', 160, 50)?.position.x).toBeCloseTo(0.1);
    buffer.push(remote(2, 50, 0.5), 220);
    expect(buffer.samplePlayer('remote', 220, 50)?.position.x).toBeCloseTo(0.7);
  });
});
