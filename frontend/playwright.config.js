// @ts-check
import { defineConfig, devices } from 'playwright/test';

const FRONTEND_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.E2E_API_URL || 'http://localhost:5000';

export default defineConfig({
  testDir: './tests/e2e',
  // The suite used to leave every client, patient, visit and payment it created behind. Setup
  // stamps the run's start time; teardown deletes what the run made. See globalTeardown.js.
  globalSetup: './tests/e2e/globalSetup.js',
  globalTeardown: './tests/e2e/globalTeardown.js',
  fullyParallel: false,
  // One worker, deliberately.
  //
  // `fullyParallel: false` only serialises tests *within* a file — separate files still run
  // concurrently across workers, and this suite shares one database and one set of seeded
  // accounts. Specs mutate that shared state: rbac-enforcement.spec.js temporarily revokes a
  // permission from the seeded Cashier, session-revocation.spec.js changes a password,
  // discounts.spec.js settles payments. Run in parallel, those changes are visible to whichever
  // other file happens to be mid-flight, which surfaces as unrelated specs failing at random —
  // the same misleading signature as the rate limiter and a mid-run nodemon restart.
  //
  // The whole suite takes about 14 seconds serially. That is a cheap price for a result that
  // means what it says.
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30000,
  use: {
    // Pinned, not inherited. [1.39.0] Playwright happens to default to 'light', so the suite
    // passed today by luck of a library default — a CI machine or a contributor with a dark
    // OS preference would otherwise move all 191 specs onto a theme nothing has validated,
    // and they would fail for a reason that looks nothing like the cause.
    colorScheme: 'light',
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Assumes both dev servers are already running (see frontend/tests/e2e/README.md).
  // Not using Playwright's `webServer` auto-start here because the backend requires a live
  // PostgreSQL connection that this config has no safe way to verify beforehand.
  metadata: {
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
  },
});
