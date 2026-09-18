import { defineConfig, devices } from "@playwright/test";

import { loadEnvFiles } from "./src/lib/load-env-files";

// Playwright's own Node process never reads `.env`/`.env.local` on its own,
// unlike `next dev`, which loads them itself once spawned below. Without this,
// `hasPortalContactCredentials` could never see a value that lives only in a
// dotenv file, exactly the shape `E2E_CLERK_CONTACT_*` and the Clerk keys are
// kept in (`drizzle.config.ts` and every script under `scripts/` load the same
// way, for the same reason).
loadEnvFiles();

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
 * A second, dedicated dev server and project for `e2e/portal-contact.spec.ts`
 * (spec 0014, AC-16), the one suite that has to sign in for real.
 *
 * The default server below blanks the Clerk keys on purpose, so every other
 * spec runs signed out; sharing it with a suite that needs a genuine session
 * would mean choosing one behaviour and breaking the other. This server keeps
 * whatever Clerk keys the runner actually has, on its own port, and only
 * exists at all when the three `E2E_CLERK_CONTACT_*` variables and both Clerk
 * keys are present, so an ordinary run (no credentials, exactly CI's browser
 * job today) never pays for a second `next dev` it will not use.
 */
const PORTAL_CONTACT_PORT = 3101;
const portalContactBaseURL = `http://localhost:${PORTAL_CONTACT_PORT}`;

const hasPortalContactCredentials = Boolean(
  process.env.CLERK_SECRET_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.E2E_CLERK_CONTACT_USERNAME &&
  process.env.E2E_CLERK_CONTACT_PASSWORD &&
  process.env.E2E_CLERK_CONTACT_USER_ID,
);

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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /portal-contact\.spec\.ts/,
    },
    ...(hasPortalContactCredentials
      ? [
          {
            name: "portal-contact",
            testMatch: /portal-contact\.spec\.ts/,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: portalContactBaseURL,
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // `corepack pnpm`, not bare `pnpm`: some environments (sandboxes, fresh
      // machines before `corepack enable` has run) only resolve pnpm through
      // corepack, and `next dev` doesn't care which one launched it.
      command: `corepack pnpm dev --port ${PORT}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      /**
       * No Clerk credentials and no R2 credentials, deliberately, so a local
       * run behaves exactly like CI's browser job, which has none of either.
       *
       * Spec 0005 narrowed `src/proxy.ts` to require a session on everything
       * outside a short public list, and without a publishable key that proxy is a
       * pass through (see `src/lib/env.ts`). That is what keeps `/dashboard`,
       * `/design` and the rest reachable here. With the keys a developer has in
       * their own `.env`, every one of those routes would redirect to `/sign-in`
       * and the suite would go red on their machine and stay green on CI, which is
       * the worst of both.
       *
       * The same goes for the four `R2_*` variables: `e2e/deliverables.spec.ts`
       * asserts the download route's storage not configured branch, which
       * only trips when `isR2Configured()` is false. A developer's own `.env`
       * has real R2 credentials, so without this blank the suite is red only on
       * their machine, same failure mode as the Clerk keys above.
       *
       * Blanking rather than removing: `next dev` reads `.env` itself, and its
       * loader leaves a variable already present in the environment alone.
       *
       * Signing the staff suite in properly is specified in spec 0005 and
       * belongs to `/test`; the client portal's own signed in suite runs
       * against the second server below instead of this one.
       */
      env: {
        // Spread, because Playwright *replaces* the environment rather than
        // merging into it, and the command needs PATH to find pnpm at all.
        ...definedEnv(),
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
        CLERK_SECRET_KEY: "",
        R2_ACCOUNT_ID: "",
        R2_ACCESS_KEY_ID: "",
        R2_SECRET_ACCESS_KEY: "",
        R2_BUCKET: "",
        // No observability provider either (spec 0019, AC-22): the suite
        // asserts nothing leaves for `/ingest` or `sentry.io`, and a
        // developer's own keys must not make that assertion red locally.
        NEXT_PUBLIC_SENTRY_DSN: "",
        NEXT_PUBLIC_POSTHOG_KEY: "",
        NEXT_PUBLIC_VERCEL_ENV: "",
        VERCEL_ENV: "",
      },
    },
    ...(hasPortalContactCredentials
      ? [
          {
            command: `corepack pnpm dev --port ${PORTAL_CONTACT_PORT}`,
            url: portalContactBaseURL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            env: {
              // The real Clerk keys pass through unchanged, on purpose: this
              // is the one server that has to be signed in for real.
              ...definedEnv(),
              // Its own build directory: `next dev` refuses a second instance
              // sharing the default server's `.next` (see `next.config.ts`).
              NEXT_DIST_DIR: ".next-portal-contact",
              // Still no observability provider (spec 0019, AC-22).
              NEXT_PUBLIC_SENTRY_DSN: "",
              NEXT_PUBLIC_POSTHOG_KEY: "",
              NEXT_PUBLIC_VERCEL_ENV: "",
              VERCEL_ENV: "",
            },
          },
        ]
      : []),
  ],
});
