import { describe, expect, it } from 'vitest';
import { generateMap, type InputCommand, type PlayerSnapshot } from '@squirrel-heist/shared';
import { LocalPrediction } from '../src/prediction/localPrediction.js';

describe('client prediction and reconciliation', () => {
  it('predicts immediately then replays unacknowledged input', () => {
    const map = generateMap('prediction').map;
    const prediction = new LocalPrediction();
    prediction.configure(map, { x: -12, y: 0 });
    const input: InputCommand = { sequence: 1, clientTick: 1, moveX: 1, moveY: 0, aimX: 1, aimY: 0, buttons: 0 };
    prediction.apply(input, 0.05, false);
    expect(prediction.position.x).toBeGreaterThan(-12);
    const player = { id: 'local', position: { x: -12, y: 0 }, lastProcessedInputSequence: 0, heldAcornId: null } as PlayerSnapshot;
    prediction.reconcile(player);
    expect(prediction.position.x).toBeGreaterThan(-12);
  });
});
