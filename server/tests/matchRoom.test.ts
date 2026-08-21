import { describe, expect, it } from 'vitest';
import {
  InputButton, fixedDeltaMs, gameBalance, totalAcorns,
  type InputCommand, type PlayerId, type PlayerState, type ServerMessage, type Team
} from '@squirrel-heist/shared';
import { MatchRoom, type RoomConnection } from '../src/simulation/matchRoom.js';

const messages: ServerMessage[] = [];
const connection = (id: string): RoomConnection => ({ id, send: (message) => { messages.push(message); } });

function add(room: MatchRoom, team: Team, name: string): PlayerState {
  return room.addPlayer(connection(name), name, team);
}

function command(sequence: number, buttons = 0, moveX = 0, moveY = 0, aimX = 1, aimY = 0): InputCommand {
  return { sequence, clientTick: sequence, moveX, moveY, aimX, aimY, buttons };
}

function inputTick(room: MatchRoom, playerId: PlayerId, sequence: number, buttons = 0, moveX = 0, moveY = 0, aimX = 1, aimY = 0): void {
  room.enqueueInput(playerId, command(sequence, buttons, moveX, moveY, aimX, aimY));
  room.tick(fixedDeltaMs);
}

describe('authoritative MatchRoom', () => {
  it('assigns at most four players per team and starts eight ready players', () => {
    const room = new MatchRoom({ id: 'ready', seed: 'ready', countdownMs: 100 });
    for (let index = 0; index < 8; index += 1) add(room, index % 2 === 0 ? 'THIEF' : 'POLICE', `p${index}`);
    expect([...room.players.values()].every((player) => player.team === null)).toBe(true);
    for (const player of room.players.values()) expect(room.setAssetsReady(player.id, room.map.hash, true)).toBe(true);
    expect(room.phase).toBe('COUNTDOWN');
    expect([...room.players.values()].filter((player) => player.team === 'THIEF')).toHaveLength(4);
    for (const team of ['THIEF', 'POLICE'] as const) {
      const players = [...room.players.values()].filter((player) => player.team === team);
      players.forEach((player, index) => expect(Math.hypot(player.position.x - room.map.teamSpawns[team][index]!.x, player.position.y - room.map.teamSpawns[team][index]!.y)).toBeLessThanOrEqual(gameBalance.playerSpawnRadius));
      for (let first = 0; first < players.length; first += 1) for (let second = first + 1; second < players.length; second += 1) {
        expect(Math.hypot(players[first]!.position.x - players[second]!.position.x, players[first]!.position.y - players[second]!.position.y)).toBeGreaterThanOrEqual(gameBalance.playerRadius * 2);
      }
    }
    room.tick(100);
    expect(room.phase).toBe('PLAYING');
  });

  it('moves authoritatively, normalizes diagonals, applies collision, and ignores duplicate sequence', () => {
    const room = new MatchRoom({ id: 'move', seed: 'move', allowEarlyStart: true });
    const player = add(room, 'THIEF', 'runner');
    room.startImmediately();
    const before = { ...player.position };
    expect(room.enqueueInput(player.id, command(1, 0, 1, 1))).toBe(true);
    expect(room.enqueueInput(player.id, command(1, 0, -1, 0))).toBe(false);
    room.tick(fixedDeltaMs);
    expect(Math.hypot(player.position.x - before.x, player.position.y - before.y)).toBeCloseTo(gameBalance.playerSpeed / gameBalance.serverTickRate, 5);
    expect(room.snapshotFor(player.id).ackInputSequence).toBe(1);
  });

  it('uses facing-relative forward and strafe axes on the authoritative server', () => {
    const room = new MatchRoom({ id: 'facing-move', seed: 'facing-move', allowEarlyStart: true });
    const player = add(room, 'THIEF', 'runner');
    room.startImmediately();
    room.map.staticColliders.length = 0;
    player.position = { x: 0, y: 0 };
    inputTick(room, player.id, 1, 0, 0, 1, 0, 1);
    expect(player.position.y).toBeGreaterThan(0);
    const afterForward = { ...player.position };
    inputTick(room, player.id, 2, 0, 1, 0, 0, 1);
    expect(player.position.x).toBeGreaterThan(afterForward.x);
  });

  it('preserves nine acorns through steal, carry slowdown, drop, police return, and secure', () => {
    const room = new MatchRoom({ id: 'acorn', seed: 'acorn', allowEarlyStart: true });
    const thief = add(room, 'THIEF', 'thief');
    const police = add(room, 'POLICE', 'police');
    room.startImmediately();
    thief.position = { ...room.map.storages[0]!.center };
    inputTick(room, thief.id, 1, InputButton.ACORN);
    expect(thief.heldAcornId).not.toBeNull();
    inputTick(room, thief.id, 2, 0, 1, 0);
    expect(Math.hypot(thief.velocity.x, thief.velocity.y)).toBeCloseTo(gameBalance.playerSpeed * 0.85);
    inputTick(room, thief.id, 3, InputButton.ACORN);
    expect(thief.heldAcornId).toBeNull();
    police.position = { ...thief.position };
    inputTick(room, police.id, 1, InputButton.ACORN);
    expect(police.heldAcornId).not.toBeNull();
    inputTick(room, police.id, 2, 0);
    police.position = { ...room.map.storages[0]!.center };
    inputTick(room, police.id, 3, InputButton.ACORN);
    expect(police.heldAcornId).toBeNull();
    room.assertAcornInvariant();
    expect(room.acorns.size).toBe(totalAcorns);
  });

  it('ends the match when a thief secures all nine acorns through authoritative F actions', () => {
    const room = new MatchRoom({ id: 'secure-nine', seed: 'secure-nine', allowEarlyStart: true });
    const thief = add(room, 'THIEF', 'thief');
    room.startImmediately();
    let sequence = 1;
    for (const storage of room.map.storages) {
      for (let count = 0; count < gameBalance.acornsPerStorage; count += 1) {
        thief.position = { ...storage.center };
        inputTick(room, thief.id, sequence++, InputButton.ACORN);
        inputTick(room, thief.id, sequence++, 0);
        thief.position = { ...room.map.thiefBase.center };
        inputTick(room, thief.id, sequence++, InputButton.ACORN);
        if (room.phase !== 'FINISHED') inputTick(room, thief.id, sequence++, 0);
      }
    }
    expect(room.winner).toBe('THIEF');
    expect(room.endReason).toBe('THIEF_SECURED_ALL');
    expect(room.snapshotFor(thief.id).thiefSecuredCount).toBe(totalAcorns);
  });

  it('supports continuous arrest, cancellation, jail, oldest-first rescue, and immunity', () => {
    const room = new MatchRoom({ id: 'jail', seed: 'jail', allowEarlyStart: true });
    const police = add(room, 'POLICE', 'officer');
    const target = add(room, 'THIEF', 'target');
    const rescuer = add(room, 'THIEF', 'rescuer');
    room.startImmediately();
    police.position = { x: 0, y: 0 }; target.position = { x: 0.6, y: 0 };
    inputTick(room, police.id, 1, InputButton.INTERACT);
    inputTick(room, police.id, 2, 0);
    expect(room.interactions.get(police.id)?.kind).toBe('NONE');
    for (let tick = 3; tick < 3 + gameBalance.arrestHoldMs / fixedDeltaMs; tick += 1) inputTick(room, police.id, tick, InputButton.INTERACT);
    expect(target.mode).toBe('JAILED');
    inputTick(room, police.id, 20, 0);
    rescuer.position = { ...room.map.jail.center };
    for (let tick = 1; tick <= gameBalance.rescueHoldMs / fixedDeltaMs; tick += 1) inputTick(room, rescuer.id, tick, InputButton.INTERACT);
    expect(target.mode).toBe('NORMAL');
    expect(target.arrestImmuneUntilMs).toBeGreaterThan(room.nowMs);
  });

  it('fires thunder against enemies only, stuns for 1.5 seconds, and does not drop acorns', () => {
    const room = new MatchRoom({ id: 'thunder', seed: 'thunder', allowEarlyStart: true });
    const shooter = add(room, 'POLICE', 'shooter');
    const target = add(room, 'THIEF', 'target');
    room.startImmediately();
    shooter.position = { x: -1, y: 0 }; target.position = { x: 1, y: 0 }; shooter.hasThunder = true;
    const acorn = [...room.acorns.values()][0]!; acorn.location = { kind: 'CARRIED', carrierId: target.id }; target.heldAcornId = acorn.id;
    inputTick(room, shooter.id, 1, InputButton.FIRE, 0, 0, 1, 0);
    expect(target.mode).toBe('STUNNED');
    expect(room.thunderEffects.size).toBe(1);
    for (let tick = 2; tick < 6 && target.mode !== 'STUNNED'; tick += 1) inputTick(room, shooter.id, tick, 0, 0, 0, 1, 0);
    expect(target.mode).toBe('STUNNED');
    expect(target.heldAcornId).toBe(acorn.id);
    for (let tick = 0; tick < gameBalance.thunderStunMs / fixedDeltaMs; tick += 1) room.tick(fixedDeltaMs);
    expect(target.mode).toBe('NORMAL');
  });

  it('clips a hitscan thunder effect at the irregular playable-area boundary', () => {
    const room = new MatchRoom({ id: 'boundary-shot', seed: 'boundary-shot', allowEarlyStart: true });
    const shooter = add(room, 'POLICE', 'shooter');
    room.startImmediately();
    shooter.position = { x: 30, y: 0 };
    shooter.hasThunder = true;
    inputTick(room, shooter.id, 1, InputButton.FIRE, 0, 0, 1, 0);
    const effect = [...room.thunderEffects.values()][0];
    expect(effect).toBeDefined();
    expect(effect!.end.x).toBeLessThanOrEqual(room.map.bounds.max.x);
    room.tick(gameBalance.thunderBeamDurationMs);
    expect(room.thunderEffects.size).toBe(0);
  });

  it('keeps a replacement reconnect transport when the old socket closes late', () => {
    const room = new MatchRoom({ id: 'replace-transport', seed: 'replace-transport' });
    const old = connection('old');
    const player = room.addPlayer(old, 'player', 'THIEF');
    const replacement = connection('replacement');
    expect(room.reconnect(player.reconnectToken, replacement)?.id).toBe(player.id);

    room.disconnect(player.id, old.id);

    expect(player.connectionId).toBe(replacement.id);
    expect(room.connections.get(player.id)?.id).toBe(replacement.id);
  });

  it('returns a disconnected countdown to lobby and resumes after reconnect', () => {
    const room = new MatchRoom({ id: 'countdown-reconnect', seed: 'countdown-reconnect' });
    for (let index = 0; index < 8; index += 1) add(room, index % 2 === 0 ? 'THIEF' : 'POLICE', `ready-${index}`);
    for (const player of room.players.values()) room.setAssetsReady(player.id, room.map.hash, true);
    const disconnected = [...room.players.values()][0]!;
    expect(room.phase).toBe('COUNTDOWN');
    room.disconnect(disconnected.id, disconnected.connectionId!);
    expect(room.phase).toBe('LOBBY');
    expect([...room.players.values()].every((player) => player.team === null)).toBe(true);
    expect(room.reconnect(disconnected.reconnectToken, connection('replacement'))?.id).toBe(disconnected.id);
    expect(room.phase).toBe('COUNTDOWN');
    expect([...room.players.values()].filter((player) => player.team === 'THIEF')).toHaveLength(4);
  });

  it('rejects a reconnect token after its playing grace period expires', () => {
    const room = new MatchRoom({ id: 'expired-reconnect', seed: 'expired-reconnect' });
    const expired = room.addPlayer(connection('expired'), 'expired', 'THIEF');
    room.addPlayer(connection('active'), 'active', 'POLICE');
    room.startImmediately();
    room.disconnect(expired.id, 'expired');
    room.tick(gameBalance.reconnectGraceMs + 1);

    expect(room.reconnect(expired.reconnectToken, connection('too-late'))).toBeNull();
  });

  it('fires thunder using the aim from the same input that presses fire', () => {
    const room = new MatchRoom({ id: 'fresh-aim', seed: 'fresh-aim', allowEarlyStart: true });
    const shooter = add(room, 'POLICE', 'shooter');
    room.startImmediately();
    room.map.staticColliders.length = 0;
    shooter.position = { x: 0, y: 0 };
    shooter.facing = { x: 1, y: 0 };
    shooter.hasThunder = true;

    inputTick(room, shooter.id, 1, InputButton.FIRE, 0, 0, 0, 1);

    const effect = [...room.thunderEffects.values()][0];
    expect(effect?.end.x).toBeCloseTo(effect?.start.x ?? 0);
    expect((effect?.end.y ?? 0) - (effect?.start.y ?? 0)).toBeGreaterThan(0);
    expect(shooter.facing).toEqual({ x: 0, y: 1 });
  });

  it('preserves rising-edge actions when press and release inputs arrive before one tick', () => {
    const room = new MatchRoom({ id: 'queued-edge', seed: 'queued-edge', allowEarlyStart: true });
    const shooter = add(room, 'POLICE', 'shooter');
    room.startImmediately();
    room.map.staticColliders.length = 0;
    shooter.position = { x: 0, y: 0 };
    shooter.hasThunder = true;

    room.enqueueInput(shooter.id, command(1, InputButton.FIRE, 0, 0, 0, 1));
    room.enqueueInput(shooter.id, command(2, 0, 0, 0, 0, 1));
    room.tick(fixedDeltaMs);

    expect(room.thunderEffects.size).toBe(1);
    expect(shooter.hasThunder).toBe(false);
    expect(room.snapshotFor(shooter.id).ackInputSequence).toBe(2);
  });

  it('resolves a hitscan wall before a player behind it', () => {
    const room = new MatchRoom({ id: 'wall-first', seed: 'wall-first', allowEarlyStart: true });
    const shooter = add(room, 'POLICE', 'shooter');
    const target = add(room, 'THIEF', 'target');
    room.startImmediately();
    shooter.position = { x: -1, y: 0 }; target.position = { x: 1, y: 0 }; shooter.hasThunder = true;
    room.map.staticColliders.push({ min: { x: 0, y: -1 }, max: { x: 0.2, y: 1 } });
    inputTick(room, shooter.id, 1, InputButton.FIRE, 0, 0, 1, 0);
    expect(target.mode).toBe('NORMAL');
    const effect = [...room.thunderEffects.values()][0];
    expect(effect?.hitPlayerId).toBeNull();
    expect(effect?.end.x).toBeLessThanOrEqual(0);
  });

  it('requires friend-room role selection, explicit ready, and host start after assets load', () => {
    const room = new MatchRoom({ id: 'private-ready', seed: 'private-ready', lobbyKind: 'FRIEND_ROOM', allowEarlyStart: true });
    const player = room.addPlayer(connection('friend'), 'friend', null);
    expect(room.hostPlayerId).toBe(player.id);
    expect(room.setAssetsReady(player.id, room.map.hash, true)).toBe(true);
    expect(player.ready).toBe(false);
    expect(() => room.setPlayerReady(player.id, true)).toThrow('READY_REJECTED');
    expect(room.setRolePreference(player.id, 'POLICE')).toBe(true);
    expect(room.setPlayerReady(player.id, true)).toBe(true);
    expect(room.phase).toBe('LOBBY');
    expect(room.startMatch(player.id)).toBe(true);
    expect(room.phase).toBe('COUNTDOWN');
  });

  it('starts a friend room only when its host confirms eight ready choices and finalizes four-versus-four', () => {
    const room = new MatchRoom({ id: 'private-eight', seed: 'private-eight', lobbyKind: 'FRIEND_ROOM' });
    const players = Array.from({ length: 8 }, (_, index) => room.addPlayer(connection(`friend-${index}`), `friend-${index}`, null));
    players.forEach((player, index) => {
      expect(room.setAssetsReady(player.id, room.map.hash, true)).toBe(true);
      expect(room.setRolePreference(player.id, index < 4 ? 'POLICE' : 'THIEF')).toBe(true);
      if (index < 7) expect(room.setPlayerReady(player.id, true)).toBe(true);
    });
    expect(room.phase).toBe('LOBBY');
    expect(players.every((player) => player.team === null)).toBe(true);
    expect(room.setPlayerReady(players[7]!.id, true)).toBe(true);
    expect(room.phase).toBe('LOBBY');
    expect(() => room.startMatch(players[1]!.id)).toThrow('HOST_ONLY');
    expect(room.startMatch(players[0]!.id)).toBe(true);
    expect(room.phase).toBe('COUNTDOWN');
    expect(players.filter((player) => player.team === 'POLICE')).toHaveLength(4);
    expect(players.filter((player) => player.team === 'THIEF')).toHaveLength(4);
  });

  it('allows overlapping friend role selections but rejects the fifth ready player with a toast-ready error', () => {
    const room = new MatchRoom({ id: 'role-overflow', seed: 'role-overflow', lobbyKind: 'FRIEND_ROOM' });
    const players = Array.from({ length: 5 }, (_, index) => room.addPlayer(connection(`friend-${index}`), `friend-${index}`, null));
    for (const player of players) {
      expect(room.setAssetsReady(player.id, room.map.hash, true)).toBe(true);
      expect(room.setRolePreference(player.id, 'POLICE')).toBe(true);
    }
    players.slice(0, 4).forEach((player) => expect(room.setPlayerReady(player.id, true)).toBe(true));
    expect(() => room.setPlayerReady(players[4]!.id, true)).toThrow('ROLE_FULL');
    expect(players[4]!.ready).toBe(false);
  });

  it('transfers friend-room host authority to a selected player and on host disconnect', () => {
    const room = new MatchRoom({ id: 'host-transfer', seed: 'host-transfer', lobbyKind: 'FRIEND_ROOM' });
    const host = room.addPlayer(connection('host'), 'host', null);
    const friend = room.addPlayer(connection('friend'), 'friend', null);
    const next = room.addPlayer(connection('next'), 'next', null);
    expect(() => room.transferHost(friend.id, next.id)).toThrow('HOST_ONLY');
    expect(room.transferHost(host.id, friend.id)).toBe(true);
    expect(room.snapshotFor(host.id).hostPlayerId).toBe(friend.id);
    room.disconnect(friend.id, 'friend');
    expect(room.hostPlayerId).toBe(host.id);
  });

  it('gives thief securing priority over all-jailed and timeout on the same tick', () => {
    const room = new MatchRoom({ id: 'priority', seed: 'priority', allowEarlyStart: true });
    for (let index = 0; index < 4; index += 1) { const thief = add(room, 'THIEF', `t${index}`); thief.mode = 'JAILED'; }
    [...room.acorns.values()].forEach((acorn, slot) => { acorn.location = { kind: 'SECURED', slot }; });
    room.remainingMs = 0;
    room.startImmediately(); room.tick(fixedDeltaMs);
    expect(room.winner).toBe('THIEF');
    expect(room.endReason).toBe('THIEF_SECURED_ALL');
  });

  it('awards police victory on timeout and permits grace-period reconnect/full resync', () => {
    const room = new MatchRoom({ id: 'reconnect', seed: 'reconnect', allowEarlyStart: true });
    const player = add(room, 'POLICE', 'player');
    const token = player.reconnectToken;
    room.startImmediately();
    room.disconnect(player.id);
    expect(room.reconnect(token, connection('again'))?.id).toBe(player.id);
    expect(room.fullStateFor(player.id).type).toBe('S2C_FULL_STATE');
    room.remainingMs = fixedDeltaMs;
    room.tick(fixedDeltaMs);
    expect(room.winner).toBe('POLICE');
    expect(room.endReason).toBe('TIME_EXPIRED');
  });

  it('awards police victory only after all four thieves remain jailed for one second', () => {
    const room = new MatchRoom({ id: 'all-jailed', seed: 'all-jailed', allowEarlyStart: true });
    for (let index = 0; index < 8; index += 1) add(room, index % 2 === 0 ? 'THIEF' : 'POLICE', `player-${index}`);
    room.startImmediately();
    for (const player of room.players.values()) if (player.team === 'THIEF') player.mode = 'JAILED';
    for (let tick = 0; tick < gameBalance.allJailedConfirmMs / fixedDeltaMs; tick += 1) room.tick(fixedDeltaMs);
    expect(room.phase).toBe('PLAYING');
    room.tick(fixedDeltaMs);
    expect(room.winner).toBe('POLICE');
    expect(room.endReason).toBe('ALL_THIEVES_JAILED');
  });

  it('spawns berries on the server and enforces one thunder pickup per player', () => {
    const room = new MatchRoom({ id: 'berry', seed: 'berry', allowEarlyStart: true });
    const player = add(room, 'THIEF', 'forager');
    room.startImmediately();
    for (let tick = 0; tick < gameBalance.berrySpawnMaxMs / fixedDeltaMs + 1 && room.berries.size === 0; tick += 1) room.tick(fixedDeltaMs);
    const berry = [...room.berries.values()][0];
    expect(berry).toBeDefined();
    expect(room.map.berrySpawnPoints.some((center) => Math.hypot(center.x - berry!.position.x, center.y - berry!.position.y) <= gameBalance.berrySpawnRadius)).toBe(true);
    player.position = { ...berry!.position };
    room.tick(fixedDeltaMs);
    expect(player.hasThunder).toBe(true);
    expect(room.berries.has(berry!.id)).toBe(false);
  });
});
