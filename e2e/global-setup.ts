import { request } from "@playwright/test";

/**
 * Warm the routes once before the suite runs.
 *
 * `next dev` compiles a route the first time it is asked for it. Without this,
 * whichever test happens to touch a route first pays that cost and can time out
 * while the other workers wait, which reads as a flaky application rather than a
 * cold compiler.
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
}
