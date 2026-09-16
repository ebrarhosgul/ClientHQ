import { clerkSetup } from "@clerk/testing/playwright";
import { request } from "@playwright/test";

/**
 * Warm the routes once before the suite runs, and, when a signed in suite is
 * about to run against a real Clerk development instance, fetch the testing
 * token that lets it past Clerk's bot protection (`e2e/CLERK.md`).
 *
 * `next dev` compiles a route the first time it is asked for it. Without the
 * warm up, whichever test happens to touch a route first pays that cost and
 * can time out while the other workers wait, which reads as a flaky
 * application rather than a cold compiler.
 *
 * `clerkSetup()` needs `CLERK_SECRET_KEY` and
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in *this* process's environment, the
 * runner's, not the blanked pair `playwright.config.ts` hands the signed out
 * server. It only runs when `playwright.config.ts` has decided a signed in
 * project exists at all (`hasPortalContactCredentials`); calling it with no
 * real keys would fail every run, including the signed out suite CI runs on
 * every push with no Clerk credentials at all.
 */
export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
  const context = await request.newContext({ baseURL });

  try {
    await context.get("/", { timeout: 120_000 });
    await context.get("/api/health/db", { timeout: 120_000 });
  } finally {
    await context.dispose();
  }

  if (
    process.env.CLERK_SECRET_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    process.env.E2E_CLERK_CONTACT_USERNAME &&
    process.env.E2E_CLERK_CONTACT_PASSWORD &&
    process.env.E2E_CLERK_CONTACT_USER_ID
  ) {
    await clerkSetup();
  }
}
