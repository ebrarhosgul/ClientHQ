import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// localhost, not 127.0.0.1: `next dev` treats the raw IP as a cross origin host
// and blocks its own hot reload socket, which surfaces as a console error that
// has nothing to do with the application.
const baseURL = `http://localhost:${PORT}`;
// Read by the global setup, which runs before any fixture exists.
process.env.PLAYWRIGHT_BASE_URL = baseURL;

/** `process.env` with the unset entries dropped, which is the shape Playwright wants. */
function definedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

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
  // On CI, the GitHub reporter annotates the diff and the HTML report is
  // uploaded as an artifact when the run fails, so a red build can be read
  // without rerunning it locally.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
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
    /**
     * No Clerk credentials, deliberately, so a local run behaves exactly like
     * CI's browser job, which has none at all.
     *
     * Spec 0005 narrowed `src/proxy.ts` to require a session on everything
     * outside a short public list, and without a publishable key that proxy is a
     * pass through (see `src/lib/env.ts`). That is what keeps `/dashboard`,
     * `/design` and the rest reachable here. With the keys a developer has in
     * their own `.env`, every one of those routes would redirect to `/sign-in`
     * and the suite would go red on their machine and stay green on CI, which is
     * the worst of both.
     *
     * Blanking rather than removing: `next dev` reads `.env` itself, and its
     * loader leaves a variable already present in the environment alone.
     *
     * Signing the suite in properly, with Clerk testing tokens and the
     * `E2E_CLERK_USER_*` pair, is specified in spec 0005 and belongs to `/test`.
     */
    env: {
      // Spread, because Playwright *replaces* the environment rather than
      // merging into it, and the command needs PATH to find pnpm at all.
      ...definedEnv(),
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "",
    },
  },
});
