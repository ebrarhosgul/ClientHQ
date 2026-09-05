import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// localhost, not 127.0.0.1: `next dev` treats the raw IP as a cross origin host
// and blocks its own hot reload socket, which surfaces as a console error that
// has nothing to do with the application.
const baseURL = `http://localhost:${PORT}`;
// Read by the global setup, which runs before any fixture exists.
process.env.PLAYWRIGHT_BASE_URL = baseURL;

/**
 * End to end tests, run against the real application.
 *
 * The dev server is used rather than a production build because these specs
 * only exercise the scaffold, and `next build` adds around a minute for nothing
 * they check. Swap `command` to `pnpm build && pnpm start` once a spec depends
 * on production behaviour such as caching or minified output.
 *
 * Port 3100, not 3000, so a `pnpm dev` you already have open keeps running and
 * the suite still gets a server it controls.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  // The dev server compiles a route the first time it is asked for it, which
  // can outrun the default on a cold start.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
