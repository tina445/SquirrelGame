import { describe, expect, it } from 'vitest';
import { gameBalance, generateMap, type InputCommand, type PlayerId, type PlayerSnapshot, type WorldSnapshot } from '@squirrel-heist/shared';
import { LocalPrediction } from '../src/prediction/localPrediction.js';
import { resumeInputSequence, SnapshotBuffer } from '../src/prediction/snapshotBuffer.js';

const remote = (serverTick: number, serverTimeMs: number, x: number, mode: PlayerSnapshot['mode'] = 'NORMAL'): WorldSnapshot => ({
  serverTick, serverTimeMs, phase: 'PLAYING', remainingMs: 1_000, hostPlayerId: null,
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
    expect(prediction.position.y).toBeGreaterThan(0);
    const player = { id: 'local', position: { x: -12, y: 0 }, lastProcessedInputSequence: 0, heldAcornId: null } as PlayerSnapshot;
    prediction.reconcile(player);
    expect(prediction.position.y).toBeGreaterThan(0);
  });

  it('advances the local visual position on 60fps frames while commands remain at 20Hz', () => {
    const prediction = new LocalPrediction();
    prediction.configure(generateMap('visual-prediction').map, { x: -12, y: 0 });
    const samples = Array.from({ length: 4 }, () => prediction.advanceVisual({ x: 1, y: 0 }, 1 / 60, false, true).x);
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

  it('advances remote interpolation on 60fps frames between 10Hz snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    buffer.push(remote(2, 100, 1), 200);
    buffer.push(remote(3, 200, 2), 300);
    const first = buffer.samplePlayer('remote', 250);
    const nextFrame = buffer.samplePlayer('remote', 266);
    expect(first?.position.x).toBeCloseTo(0);
    expect(nextFrame?.position.x).toBeCloseTo(0.16);
  });

  it('caps packet-gap extrapolation and snaps jail teleports', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    buffer.push(remote(2, 100, 1), 200);
    expect(buffer.samplePlayer('remote', 500)?.position.x).toBeCloseTo(2);
    buffer.push(remote(3, 200, 12, 'JAILED'), 300);
    expect(buffer.samplePlayer('remote', 450)?.position.x).toBeCloseTo(12);
  });

  it('does not rewind the render clock when a snapshot arrives late', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(remote(1, 0, 0), 100);
    buffer.push(remote(3, 200, 2), 300);
    const beforeLateArrival = buffer.samplePlayer('remote', 450);
    buffer.push(remote(2, 100, 1), 500);
    const afterLateArrival = buffer.samplePlayer('remote', 500);
    expect(beforeLateArrival?.position.x).toBeCloseTo(2);
    expect(afterLateArrival?.position.x).toBeGreaterThanOrEqual(beforeLateArrival!.position.x);
  });

  it('adapts interpolation delay to p95 jitter and clamps it to 150-250ms', () => {
    const stable = new SnapshotBuffer();
    stable.push(remote(1, 0, 0), 100);
    stable.push(remote(2, 100, 1), 200);
    expect(stable.interpolationDelayMs).toBe(150);

    const jittery = new SnapshotBuffer();
    jittery.push(remote(1, 0, 0), 100);
    jittery.push(remote(2, 100, 1), 260);
    expect(jittery.interpolationDelayMs).toBe(250);
  });

  it('resumes input after the local player ACK without rewinding an active sequence', () => {
    const local = { ...remote(1, 0, 0).players[0]!, lastProcessedInputSequence: 41 };
    expect(resumeInputSequence(0, local)).toBe(42);
    expect(resumeInputSequence(50, local)).toBe(50);
  });
});
