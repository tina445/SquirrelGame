import { describe, expect, it } from 'vitest';
import { generateMap, type PlayerId, type PlayerSnapshot, type WorldSnapshot } from '@squirrel-heist/shared';
import { BotController, BotNavigator, BotPerception, defaultBotPolicyByTeam } from '../src/index.js';

const player = (id: string, team: 'THIEF' | 'POLICE', x: number, y: number): PlayerSnapshot => ({
  id: id as PlayerId, displayName: id, team, rolePreference: team, position: { x, y }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
  mode: 'NORMAL', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0, jailedAtMs: null,
  disconnectedAtMs: null, assetsReady: true, ready: true, lastProcessedInputSequence: -1
});

const snapshot = (players: PlayerSnapshot[], serverTimeMs = 0): WorldSnapshot => ({
  serverTick: serverTimeMs / 50, serverTimeMs, ackInputSequence: -1, phase: 'PLAYING', remainingMs: 360_000,
  hostPlayerId: null, players, acorns: [], berries: [], thunderEffects: [], interactions: [], thiefSecuredCount: 0
});

describe('bot core', () => {
  it('uses the latest evaluated role-specific production policies', () => {
    expect(defaultBotPolicyByTeam).toEqual({ THIEF: 'RULE_BASED', POLICE: 'RULE_BASED' });
  });
  it('limits opponents to visible range and expires remembered sightings after two seconds', () => {
    const map = generateMap('bot-perception').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = player('self', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y);
    const enemy = player('enemy', 'POLICE', self.position.x + 10, self.position.y);
    const perception = new BotPerception();
    expect(perception.observe(map, snapshot([self, enemy], 0), self.id).opponents).toMatchObject([{ id: enemy.id, visible: true }]);
    enemy.position = { x: self.position.x + 40, y: self.position.y };
    expect(perception.observe(map, snapshot([self, enemy], 1_000), self.id).opponents[0]).toMatchObject({ id: enemy.id, visible: false });
    expect(perception.observe(map, snapshot([self, enemy], 2_001), self.id).opponents).toEqual([]);
  });

  it('produces reproducible input sequences from the same seed and observation', () => {
    const map = generateMap('bot-determinism').map;
    const self = player('self', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y);
    const world = snapshot([self], 500);
    const first = new BotController('GREEDY', 'same-seed');
    const second = new BotController('GREEDY', 'same-seed');
    expect(first.nextInput(map, world, self.id)).toEqual(second.nextInput(map, world, self.id));
  });

  it('finds a finite navigation direction on every generated layout family', () => {
    for (let index = 0; index < 20; index += 1) {
      const map = generateMap(`bot-nav-${index}`).map;
      const direction = new BotNavigator().direction(map, map.teamSpawns.THIEF[0]!, map.storages[0]!.center, 'storage');
      expect(Number.isFinite(direction.x) && Number.isFinite(direction.y)).toBe(true);
      expect(Math.hypot(direction.x, direction.y)).toBeLessThanOrEqual(1.000001);
    }
  });
});
