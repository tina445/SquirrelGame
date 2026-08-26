import { describe, expect, it } from 'vitest';
import {
  gameBalance, generateMap, isCircleInPlayableArea, moveCircle, movementCircleColliders,
  type PlayerId, type PlayerSnapshot, type Vec2, type WorldSnapshot
} from '@squirrel-heist/shared';
import { BotController, BotNavigator, BotPerception, RuleBasedPolicy, defaultBotPolicyByTeam } from '../src/index.js';

const player = (id: string, team: 'THIEF' | 'POLICE', x: number, y: number): PlayerSnapshot => ({
  id: id as PlayerId, displayName: id, team, rolePreference: team, position: { x, y }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
  mode: 'NORMAL', heldAcornId: null, hasThunder: false, stunUntilMs: 0, arrestImmuneUntilMs: 0, jailedAtMs: null,
  disconnectedAtMs: null, assetsReady: true, ready: true, lastProcessedInputSequence: -1
});

const snapshot = (players: PlayerSnapshot[], serverTimeMs = 0): WorldSnapshot => ({
  serverTick: serverTimeMs / 50, serverTimeMs, phase: 'PLAYING', remainingMs: 360_000,
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

  it('keeps tactical sight local while exposing only minimap-public berries and acorns globally', () => {
    const map = generateMap('bot-minimap-resources').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = player('self', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y);
    const enemy = player('enemy', 'POLICE', self.position.x + 40, self.position.y);
    const farBerry = { id: 'berry' as never, position: { x: self.position.x + 35, y: self.position.y }, spawnedAtTick: 0 };
    const farAcorn = { id: 'acorn' as never, location: { kind: 'GROUND' as const, position: { x: self.position.x + 34, y: self.position.y } } };
    const world = snapshot([self, enemy]);
    world.berries = [farBerry];
    world.acorns = [farAcorn];
    const observed = new BotPerception().observe(map, world, self.id);
    expect(observed.opponents).toEqual([]);
    expect(observed.berries).toEqual([]);
    expect(observed.acorns).toEqual([]);
    expect(observed.minimapBerries).toEqual([farBerry]);
    expect(observed.minimapAcorns).toEqual([farAcorn]);
    expect(observed.minimapCarriers).toEqual([]);
  });

  it('produces reproducible input sequences from the same seed and observation', () => {
    const map = generateMap('bot-determinism').map;
    const self = player('self', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y);
    const world = snapshot([self], 500);
    const first = new BotController('GREEDY', 'same-seed');
    const second = new BotController('GREEDY', 'same-seed');
    expect(first.nextInput(map, world, self.id)).toEqual(second.nextInput(map, world, self.id));
  });

  it('preserves a stationary movement decision instead of turning it into forward motion', () => {
    const map = generateMap('bot-stationary-input').map;
    const self = { ...player('self', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y), heldAcornId: 'held' as never };
    const controller = new BotController('RULE_BASED', 'stationary');
    const world = snapshot([self], 1_000);
    const input = controller.nextInput(map, world, self.id);
    expect(Math.abs(input.moveX)).toBe(0);
    expect(Math.abs(input.moveY)).toBe(0);
  });

  it('routes an acorn-carrying thief to the thief base even when a nearby police blocks that direction', () => {
    const map = generateMap('carrier-evade-to-base').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = { ...player('carrier', 'THIEF', map.thiefBase.center.x + 10, map.thiefBase.center.y), heldAcornId: 'held' as never };
    const police = player('police', 'POLICE', self.position.x - 6, self.position.y);
    const decision = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...police, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0
    });
    expect(decision.goal).toBe('secure');
    expect(decision.moveWorld.x).toBeLessThan(0);
    expect(decision.acorn).toBe(false);
  });

  it('prioritizes an ordinary nearby thief over ground acorns and starts hold only at the close commit range', () => {
    const map = generateMap('police-arrest-priority').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = player('police', 'POLICE', map.teamSpawns.POLICE[0]!.x, map.teamSpawns.POLICE[0]!.y);
    const thief = player('thief', 'THIEF', self.position.x + 0.9, self.position.y);
    const decision = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...thief, observedAtMs: 0, visible: true }],
      acorns: [{ id: 'ground' as never, location: { kind: 'GROUND', position: { ...self.position } } }], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0
    });
    expect(decision.goal).toBe(`arrest:${thief.id}`);
    expect(decision.interact).toBe(true);
    expect(Math.hypot(decision.moveWorld.x, decision.moveWorld.y)).toBe(0);
  });

  it('pressures a visible acorn carrier directly without starting an out-of-range arrest', () => {
    const map = generateMap('police-carrier-cutoff').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const carrier = { ...player('carrier', 'THIEF', map.thiefBase.center.x + 8, map.thiefBase.center.y), heldAcornId: 'held' as never };
    const police = player('police', 'POLICE', map.thiefBase.center.x + 5, map.thiefBase.center.y);
    const decision = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self: police, teammates: [],
      opponents: [{ ...carrier, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0
    });
    expect(decision.goal).toBe(`arrest:${carrier.id}`);
    expect(decision.moveWorld.x).toBeGreaterThan(0);
    expect(decision.interact).toBe(false);
  });

  it('refreshes a carrier pursuit waypoint before the carrier opens a stale-path gap', () => {
    const map = generateMap('police-carrier-refresh').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const policy = new RuleBasedPolicy();
    const police = player('police', 'POLICE', map.thiefBase.center.x + 5, map.thiefBase.center.y);
    const carrier = { ...player('carrier', 'THIEF', police.position.x + 3, police.position.y), heldAcornId: 'held' as never };
    const observation = (self = police, target = carrier) => ({
      map, phase: 'PLAYING' as const, nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...target, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0, recentThunderHit: null
    });
    policy.decide(observation());
    const movedCarrier = { ...carrier, position: { x: carrier.position.x + 2, y: carrier.position.y } };
    const atPreviousWaypoint = { ...police, position: { ...carrier.position } };
    const refreshed = policy.decide(observation(atPreviousWaypoint, movedCarrier));
    expect(refreshed.goal).toBe(`arrest:${carrier.id}`);
    expect(refreshed.moveWorld.x).toBeGreaterThan(0);
    expect(refreshed.interact).toBe(false);
  });

  it('uses a minimap berry and commits thunder to a visible police acorn carrier', () => {
    const map = generateMap('thief-resource-tactics').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = { ...player('thief', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y), hasThunder: true };
    const carrier = { ...player('carrier', 'POLICE', self.position.x + 6, self.position.y), heldAcornId: 'carried' as never };
    const policy = new RuleBasedPolicy();
    const stealing = policy.decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...carrier, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0
    });
    expect(stealing.goal).toBe(`steal-carried:${carrier.id}`);
    expect(stealing.acorn).toBe(false);
    expect(stealing.fire).toBe(true);
    const distantCarrier = { ...carrier, position: { x: self.position.x + gameBalance.thunderRange - 0.1, y: self.position.y } };
    const maxRangeFollowUp = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...distantCarrier, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 3])), thiefSecuredCount: 0
    });
    // 2.1초 기절 동안 15-unit 최대 사거리의 운반자까지 탈취 거리로 접근할 수 있다.
    expect(maxRangeFollowUp.fire).toBe(true);
    const unarmed = { ...self, hasThunder: false };
    const berry = { id: 'berry' as never, position: { x: self.position.x + 32, y: self.position.y }, spawnedAtTick: 0 };
    const collecting = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self: unarmed, teammates: [], opponents: [], acorns: [], berries: [],
      minimapAcorns: [], minimapBerries: [berry], minimapCarriers: [], storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 0])), thiefSecuredCount: 0
    });
    expect(collecting.goal).toBe(`berry:${berry.id}`);
    const marker = { playerId: carrier.id, position: { x: self.position.x + 30, y: self.position.y } };
    const intercepting = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [], opponents: [], acorns: [], berries: [],
      minimapAcorns: [], minimapBerries: [], minimapCarriers: [marker], storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 0])), thiefSecuredCount: 0
    });
    expect(intercepting.goal).toBe(`minimap-steal:${carrier.id}`);
  });

  it('sends police to a minimap berry before low-value patrol and fires on a visible thief', () => {
    const map = generateMap('police-resource-tactics').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const self = player('police', 'POLICE', map.teamSpawns.POLICE[0]!.x, map.teamSpawns.POLICE[0]!.y);
    const berry = { id: 'berry' as never, position: { x: self.position.x + 30, y: self.position.y }, spawnedAtTick: 0 };
    const collecting = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [], opponents: [], acorns: [], berries: [],
      minimapAcorns: [], minimapBerries: [berry], minimapCarriers: [], storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 0])), thiefSecuredCount: 0
    });
    expect(collecting.goal).toBe(`berry:${berry.id}`);
    const armed = { ...self, hasThunder: true };
    const thief = player('thief', 'THIEF', self.position.x + 5, self.position.y);
    const firing = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self: armed, teammates: [],
      opponents: [{ ...thief, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 0])), thiefSecuredCount: 0
    });
    expect(firing.goal).toBe(`arrest:${thief.id}`);
    expect(firing.fire).toBe(true);
  });

  it('assigns the closest normal thief to an all-jailed rescue while others keep acorn work', () => {
    const map = generateMap('rescue-assignment').map;
    map.staticColliders.length = 0;
    map.trees.length = 0;
    const farThief = player('far', 'THIEF', map.thiefBase.center.x, map.thiefBase.center.y);
    const nearThief = player('near', 'THIEF', map.jail.escapePoints[0]!.x, map.jail.escapePoints[0]!.y);
    const jailed = { ...player('jailed', 'THIEF', map.jail.center.x, map.jail.center.y), mode: 'JAILED' as const };
    const base = {
      map, phase: 'PLAYING' as const, nowMs: 0, remainingMs: 360_000, opponents: [], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 1])), thiefSecuredCount: 0
    };
    const farDecision = new RuleBasedPolicy().decide({ ...base, self: farThief, teammates: [nearThief, jailed] });
    const nearDecision = new RuleBasedPolicy().decide({ ...base, self: nearThief, teammates: [farThief, jailed] });
    expect(farDecision.goal).toMatch(/^steal:/);
    expect(nearDecision.goal).toBe('rescue');
    expect(nearDecision.interact).toBe(true);
  });

  it('finds a finite navigation direction on every generated layout family', () => {
    for (let index = 0; index < 20; index += 1) {
      const map = generateMap(`bot-nav-${index}`).map;
      const direction = new BotNavigator().direction(map, map.teamSpawns.THIEF[0]!, map.storages[0]!.center, 'storage');
      expect(Number.isFinite(direction.x) && Number.isFinite(direction.y)).toBe(true);
      expect(Math.hypot(direction.x, direction.y)).toBeLessThanOrEqual(1.000001);
    }
  });

  it('uses a playable grid step instead of fleeing through an irregular polygon edge', () => {
    const map = generateMap('bot-flee-polygon-edge').map;
    const circles = movementCircleColliders(map);
    let edge: Vec2 | null = null;
    for (let y = map.bounds.min.y + 1; y < map.bounds.max.y - 1 && !edge; y += 0.5) for (let x = map.bounds.min.x + 1; x < map.bounds.max.x - 1; x += 0.5) {
      const candidate = { x, y };
      if (!isCircleInPlayableArea(candidate, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles)) continue;
      const directAway = moveCircle(candidate, { x: -0.75, y: 0 }, gameBalance.playerRadius, map.bounds, map.staticColliders, map.playableArea, map.playableHoles, circles);
      if (directAway.x === candidate.x) edge = candidate;
    }
    expect(edge).not.toBeNull();
    const navigator = new BotNavigator();
    const direction = navigator.fleeDirection(map, edge!, { x: edge!.x + 4, y: edge!.y });
    const moved = moveCircle(edge!, { x: direction.x * 0.75, y: direction.y * 0.75 }, gameBalance.playerRadius,
      map.bounds, map.staticColliders, map.playableArea, map.playableHoles, circles);
    expect(Math.hypot(direction.x, direction.y)).toBeGreaterThan(0);
    expect(moved).not.toEqual(edge);
    expect(isCircleInPlayableArea(moved, gameBalance.playerRadius, map.bounds, map.playableArea, map.playableHoles)).toBe(true);
    const self = player('edge-thief', 'THIEF', edge!.x, edge!.y);
    const police = player('edge-police', 'POLICE', edge!.x + 4, edge!.y);
    const decision = new RuleBasedPolicy().decide({
      map, phase: 'PLAYING', nowMs: 0, remainingMs: 360_000, self, teammates: [],
      opponents: [{ ...police, observedAtMs: 0, visible: true }], acorns: [], berries: [], minimapAcorns: [], minimapBerries: [], minimapCarriers: [],
      storageAcornCounts: Object.fromEntries(map.storages.map((storage) => [storage.id, 0])), thiefSecuredCount: 0
    });
    expect(decision.goal).toBe('flee');
    expect(moveCircle(edge!, { x: decision.moveWorld.x * 0.75, y: decision.moveWorld.y * 0.75 }, gameBalance.playerRadius,
      map.bounds, map.staticColliders, map.playableArea, map.playableHoles, circles)).not.toEqual(edge);
  });

  it('keeps flee directions deterministic on a map with a playable hole', () => {
    let map = generateMap('bot-flee-hole-0').map;
    for (let index = 1; map.layoutKind !== 'RING' && index < 100; index += 1) map = generateMap(`bot-flee-hole-${index}`).map;
    expect(map.playableHoles.length).toBeGreaterThan(0);
    const start = map.teamSpawns.THIEF[0]!;
    const threat = { x: start.x + 4, y: start.y };
    expect(new BotNavigator().fleeDirection(map, start, threat)).toEqual(new BotNavigator().fleeDirection(map, start, threat));
  });
});
