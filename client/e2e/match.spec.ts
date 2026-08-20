import { test, expect } from '@playwright/test';

test('client opens the lobby and creates a private room', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('도토리 대소동');
  await expect(page.locator('#lobby')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#lobby-connection')).toHaveText('서버 연결 완료');
  await page.locator('#display-name').fill('테스트 다람쥐');
  await page.locator('#create-room').click();
  await expect(page.locator('#room-panel')).toBeVisible();
  await expect(page.locator('#room-code')).toHaveText(/[A-F0-9]{6}/);
  await expect(page.locator('#assigned-team')).toHaveText(/도둑 다람쥐|경찰 다람쥐/);
  await expect(page.locator('#lobby-roster')).toContainText('테스트 다람쥐');
  await expect(page.locator('#hud')).toBeHidden();
});
