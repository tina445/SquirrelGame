import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './client/e2e',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: [
    { command: 'npm run start -w server', port: 8080, reuseExistingServer: true },
    { command: 'npm run preview -w client', port: 4173, reuseExistingServer: true }
  ]
});
