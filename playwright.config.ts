import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/ports.js';

/**
 * End-to-end tests run against the built app (npm run build) served by the real server with a fake relay.
 * With E2E_BASE_URL set, only the read-only live checks (e2e/live.spec.ts) run, against that site.
 */
const live = process.env.E2E_BASE_URL ?? '';

export default defineConfig({
  testDir: 'e2e',
  ...(live ? { testMatch: 'live.spec.ts' } : { testIgnore: 'live.spec.ts' }),
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: { baseURL: live || E2E.origin, trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-iphone13', use: { ...devices['iPhone 13'] } },
  ],
  ...(live
    ? {}
    : {
        webServer: {
          command: 'npx tsx e2e/server.ts',
          url: `${E2E.origin}/healthz`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      }),
});
