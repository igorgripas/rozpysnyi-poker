import { defineConfig, devices } from '@playwright/test';

// E2E веб-клієнта: вузький телефон (360px) і десктоп; сервер — справжній (apps/server).
// Пакети монорепо тести імпортують з вихідних TS: скрипт `e2e` задає умову `source`
// (NODE_OPTIONS), тож у чистому checkout dist не потрібен.
const WEB_PORT = 5174;
const SERVER_PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Візуальні тести (visual.spec.ts): невеликий допуск на згладжування шрифтів.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-360',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // Сервер без DATABASE_URL: кімнати лише в памʼяті.
      command: 'node --import tsx --conditions=source src/main.ts',
      cwd: '../server',
      url: `http://localhost:${SERVER_PORT}/health`,
      env: { PORT: String(SERVER_PORT), PUBLIC_URL: `http://localhost:${WEB_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
    {
      // Напряму, без обгортки pnpm: інакше Playwright не може зупинити сервер.
      command: `vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { POKER_SERVER_URL: `http://localhost:${SERVER_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
