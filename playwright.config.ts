import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/ports.js';

/** End-to-end tests run against the built app (npm run build) served by the real server with a fake relay. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: { baseURL: E2E.origin, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npx tsx e2e/server.ts',
    url: `${E2E.origin}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
