import { defineConfig, devices } from '@playwright/test';

// Mobile-first: every test runs on a phone-sized viewport (Pixel 5), plus one desktop smoke project.
export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4010', trace: 'retain-on-failure', screenshot: 'only-on-failure', ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'] } } : {}) },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop-smoke', use: { ...devices['Desktop Chrome'] }, testMatch: /storefront\.spec\.js/ }
  ],
  webServer: { command: 'node ../server/scripts/e2e-server.js', url: 'http://127.0.0.1:4010/api/health', reuseExistingServer: !process.env.CI, timeout: 30_000, cwd: '.' }
});
