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

test('guest name is stable on reload and regenerated for a new tab session', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#display-name')).toHaveValue(/^다람쥐\d{4}$/);
  const firstName = await page.locator('#display-name').inputValue();
  await page.reload();
  await expect(page.locator('#display-name')).toHaveValue(firstName);
  const secondPage = await context.newPage();
  await secondPage.goto('/');
  await expect(secondPage.locator('#display-name')).toHaveValue(/^다람쥐\d{4}$/);
  await secondPage.close();
});

test('audio channels can be controlled independently and persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#audio-toggle').click();
  await expect(page.locator('#audio-panel')).toBeVisible();
  await page.locator('#music-volume').evaluate((input: HTMLInputElement) => {
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#sfx-volume').evaluate((input: HTMLInputElement) => {
    input.value = '80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#music-mute').click();
  await expect(page.locator('#music-volume-value')).toHaveText('음소거');
  await expect(page.locator('#sfx-volume-value')).toHaveText('80%');
  await page.reload();
  await page.locator('#audio-toggle').click();
  await expect(page.locator('#music-volume')).toHaveValue('20');
  await expect(page.locator('#sfx-volume')).toHaveValue('80');
  await expect(page.locator('#music-volume-value')).toHaveText('음소거');
});

test('client creates a friend room, selects a role in the 4x2 lobby, and readies', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('도토리 대소동');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('#game canvas')).toBeHidden();
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

test('quick match preserves one pending slot across reload and can be cancelled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('빠른 매칭 다람쥐');
  await page.locator('#quick-start').click();
  await expect(page.locator('#quick-role-panel')).toBeVisible();
  await expect(page.locator('#quick-police')).toBeVisible();
  await expect(page.locator('#quick-thief')).toBeVisible();
  await expect(page.locator('#quick-random')).toBeVisible();
  await page.locator('#quick-random').click();
  await expect(page.locator('#room-panel')).toBeHidden();
  await expect(page.locator('#lobby-actions')).toBeVisible();
  await expect(page.locator('#create-room')).toBeHidden();
  await expect(page.locator('#open-join-modal')).toBeHidden();
  await expect(page.locator('#matchmaking-wait')).toBeVisible();
  await expect(page.locator('#matchmaking-elapsed')).toHaveText('00:00');
  await expect(page.locator('#matchmaking-elapsed')).toHaveText('00:01', { timeout: 1_500 });
  await expect(page.locator('#lobby-status')).toContainText('매칭 중');
  await expect(page.locator('#game canvas')).toBeHidden();
  await page.locator('#quick-start').click();
  await expect(page.locator('#lobby-actions')).toBeVisible();
  await expect(page.locator('#quick-start')).toHaveText('빠른 매칭');
  await expect(page.locator('#matchmaking-wait')).toBeHidden();

  await page.locator('#quick-start').click();
  await page.locator('#quick-random').click();
  await expect(page.locator('#matchmaking-wait')).toBeVisible();
  await expect(page.locator('#room-count')).toHaveText('1/8명');
  await page.reload();
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await expect(page.locator('#matchmaking-wait')).toBeVisible();
  await expect(page.locator('#room-count')).toHaveText('1/8명');
  await page.locator('#quick-start').click();
  await expect(page.locator('#quick-start')).toHaveText('빠른 매칭');
});

test('quick-match bots complete countdown and enter a playable authoritative match', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#quick-start').click();
  await page.locator('#quick-random').click();
  await expect(page.locator('#room-count')).toHaveText('8/8명', { timeout: 16_000 });
  await expect(page.locator('#lobby-countdown')).toBeVisible();
  await expect(page.locator('#leave-room')).toBeHidden();
  await expect(page.locator('#lobby')).toBeHidden({ timeout: 6_000 });
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
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
    await expect(page.locator('#lobby-countdown')).toBeVisible();
    await expect(page.locator('#leave-room')).toBeVisible();
    await expect(page.locator('#countdown-number')).toHaveText('3');
    await expect(page.locator('#countdown-number')).toHaveText('2', { timeout: 1_500 });
    await expect(page.locator('#game canvas')).toBeHidden();
    await expect(page.locator('#lobby')).toBeHidden({ timeout: 6_000 });
    await expect(page.locator('#lobby-countdown')).toHaveAttribute('hidden', '');
    await page.waitForTimeout(300);
    await expect(page.locator('#lobby-countdown')).toHaveAttribute('hidden', '');
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#game canvas')).toBeVisible();
    await expect(page.locator('.player-entry')).toHaveCount(8);
    if (process.env.INGAME_CAPTURE_PATH) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: process.env.INGAME_CAPTURE_PATH, animations: 'disabled' });
    }
    await page.locator('#chat-input').fill('함께 지켜요!');
    await page.locator('#chat-form').press('Enter');
    await expect(page.locator('#chat-messages')).toContainText('시작 방장: 함께 지켜요!');
    await expect(page.locator('#minimap-panel')).toBeVisible();
    expect(await page.locator('#minimap').evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels ? pixels.some((value, index) => index % 4 === 3 && value > 0) : false;
    })).toBe(true);
  } finally {
    for (const bot of bots) bot.close();
  }
});
