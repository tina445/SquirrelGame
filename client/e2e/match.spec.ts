import { test, expect } from '@playwright/test';
import { protocolVersion } from '@squirrel-heist/shared';
import WebSocket from 'ws';

async function joinReadyFriendBot(roomCode: string, displayName: string, role: 'POLICE' | 'THIEF'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:8080');
    let playerId = '';
    let assetsSent = false;
    let roleConfirmed = false;
    let readySent = false;
    const timeout = setTimeout(() => { socket.close(); reject(new Error(`friend bot ${displayName} timed out`)); }, 10_000);
    const sendReady = () => {
      if (!assetsSent || !roleConfirmed || readySent) return;
      readySent = true;
      socket.send(JSON.stringify({ type: 'C2S_SET_READY', protocolVersion, payload: { ready: true } }));
    };
    socket.on('open', () => socket.send(JSON.stringify({ type: 'C2S_JOIN_ROOM', protocolVersion, payload: { joinMode: 'JOIN_ROOM', roomCode, displayName, clientVersion: 'e2e' } })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; payload: Record<string, unknown> };
      if (message.type === 'S2C_JOINED_ROOM') {
        playerId = message.payload.playerId as string;
        socket.send(JSON.stringify({ type: 'C2S_SET_ROLE_PREFERENCE', protocolVersion, payload: { rolePreference: role } }));
      } else if (message.type === 'S2C_MAP_DEFINITION') {
        assetsSent = true;
        socket.send(JSON.stringify({ type: 'C2S_CLIENT_READY', protocolVersion, payload: { mapHash: message.payload.mapHash, assetsReady: true } }));
        sendReady();
      } else if (message.type === 'S2C_ROLE_PREFERENCE_UPDATED') {
        roleConfirmed = true;
        sendReady();
      } else if (message.type === 'S2C_WORLD_SNAPSHOT') {
        const players = message.payload.players as Array<{ id: string; ready: boolean }>;
        if (players.some((player) => player.id === playerId && player.ready)) { clearTimeout(timeout); resolve(socket); }
      } else if (message.type === 'S2C_ERROR') {
        clearTimeout(timeout);
        reject(new Error(`friend bot ${displayName}: ${String(message.payload.code)}`));
      }
    });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
  });
}

test('client creates a friend room, selects a role in the 4x2 lobby, and readies', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('도토리 대소동');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('테스트 다람쥐');
  await page.locator('#create-room').click();
  await expect(page.locator('#room-panel')).toBeVisible();
  await expect(page.locator('#room-code')).toHaveText(/[A-F0-9]{6}/);
  await expect(page.locator('#assigned-team')).toHaveText('역할을 선택해 주세요');
  await expect(page.locator('#lobby-roster')).toContainText('테스트 다람쥐');
  await expect(page.locator('#lobby-roster')).toContainText('방장');
  await expect(page.locator('.roster-slot')).toHaveCount(8);
  await expect(page.locator('#friend-start')).toBeDisabled();
  await expect(page.locator('#transfer-host')).toBeDisabled();
  await page.locator('#friend-thief').click();
  await expect(page.locator('#assigned-team')).toHaveText('도둑 다람쥐 선택 중');
  await expect(page.locator('.roster-slot').first()).toContainText('도둑 다람쥐 · 선택 중');
  await page.locator('#friend-ready').click();
  await expect(page.locator('.roster-slot').first()).toContainText('준비');
  await expect(page.locator('#friend-ready')).toHaveText('준비 취소');
  await expect(page.locator('#hud')).toBeHidden();
  await page.locator('#leave-room').click();
  await expect(page.locator('#room-panel')).toBeHidden();
  await expect(page.locator('#lobby-actions')).toBeVisible();
});

test('quick match flows through role selection into waiting', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('빠른 매칭 다람쥐');
  await page.locator('#quick-start').click();
  await expect(page.locator('#quick-role-panel')).toBeVisible();
  await expect(page.locator('#quick-police')).toBeVisible();
  await expect(page.locator('#quick-thief')).toBeVisible();
  await expect(page.locator('#quick-random')).toBeVisible();
  await page.locator('#quick-random').click();
  await expect(page.locator('#room-panel')).toBeVisible();
  await expect(page.locator('#matchmaking-wait')).toBeVisible();
  await expect(page.locator('#room-roster-content')).toBeHidden();
  await expect(page.locator('#lobby-status')).toContainText('매칭 중');
  await expect(page.locator('#friend-ready-controls')).toBeHidden();
  await page.locator('#leave-room').click();
  await expect(page.locator('#lobby-actions')).toBeVisible();
});

test('friend room blocks a fifth ready role with a toast and transfers host from a selected profile', async ({ page }) => {
  const bots: WebSocket[] = [];
  await page.goto('/');
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('기존 방장');
  await page.locator('#create-room').click();
  await expect(page.locator('#room-code')).toHaveText(/[A-F0-9]{6}/);
  const roomCode = (await page.locator('#room-code').innerText()).trim();
  try {
    for (let index = 0; index < 4; index += 1) bots.push(await joinReadyFriendBot(roomCode, `정원봇-${index}`, 'POLICE'));
    await expect(page.locator('#room-count')).toHaveText('5/8명');
    await page.locator('#friend-police').click();
    await expect(page.locator('#assigned-team')).toHaveText('경찰 다람쥐 선택 중');
    await page.locator('#friend-ready').click();
    await expect(page.locator('#lobby-toast')).toBeVisible();
    await expect(page.locator('#lobby-toast')).toContainText('이미 4명이 준비');
    await expect(page.locator('#friend-ready')).toHaveText('준비');

    const target = page.locator('.roster-slot', { hasText: '정원봇-0' });
    await target.click();
    await expect(page.locator('#transfer-host')).toBeEnabled();
    await page.locator('#transfer-host').click();
    await expect(target).toContainText('방장');
    await expect(page.locator('#friend-start')).toHaveText('방장이 시작하기를 기다리는 중');
  } finally {
    for (const bot of bots) bot.close();
  }
});

test('friend-room host starts only after eight ready players and then enters the game', async ({ page }) => {
  const bots: WebSocket[] = [];
  await page.goto('/');
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('시작 방장');
  await page.locator('#create-room').click();
  await expect(page.locator('#room-code')).toHaveText(/[A-F0-9]{6}/);
  const roomCode = (await page.locator('#room-code').innerText()).trim();
  try {
    await page.locator('#friend-police').click();
    await page.locator('#friend-ready').click();
    for (let index = 0; index < 7; index += 1) bots.push(await joinReadyFriendBot(roomCode, `시작봇-${index}`, index < 3 ? 'POLICE' : 'THIEF'));
    await expect(page.locator('#room-count')).toHaveText('8/8명');
    await expect(page.locator('.roster-slot')).toHaveCount(8);
    await expect(page.locator('#friend-start')).toBeEnabled();
    await page.locator('#friend-start').click();
    await expect(page.locator('#lobby-status')).toContainText('경기를 시작');
    await expect(page.locator('#lobby')).toBeHidden({ timeout: 6_000 });
    await expect(page.locator('#hud')).toBeVisible();
  } finally {
    for (const bot of bots) bot.close();
  }
});
