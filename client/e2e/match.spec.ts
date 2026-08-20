import { test, expect } from '@playwright/test';

test('client loads the game HUD and connects', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('도토리 대소동');
  await expect(page.locator('#prompt')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#connection')).toHaveText('연결됨');
});
