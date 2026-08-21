import { test, expect } from '@playwright/test';

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
  await expect(page.locator('.roster-slot')).toHaveCount(8);
  await page.locator('#friend-thief').click();
  await expect(page.locator('#assigned-team')).toHaveText('도둑 다람쥐 선택');
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
  await expect(page.locator('#assigned-team')).toHaveText('선택 역할로 매칭 대기 중');
  await expect(page.locator('#friend-ready-controls')).toBeHidden();
  await page.locator('#leave-room').click();
  await expect(page.locator('#lobby-actions')).toBeVisible();
});
