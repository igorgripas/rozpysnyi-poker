import { defineConfig, devices } from '@playwright/test';

// Smoke на проді після деплою (T51): живий сайт на Render, без локальних серверів.
export default defineConfig({
  testDir: '.',
  testMatch: '*.smoke.ts',
  retries: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // Безкоштовний сервер Render прокидається до ~1 хв.
  timeout: 4 * 60_000,
  expect: { timeout: 90_000 },
  use: {
    baseURL: process.env.SMOKE_URL ?? 'https://rozpysnyi-poker-pzgu.onrender.com',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
});
