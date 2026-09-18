/**
 * Next's server side instrumentation hook (spec 0019, AC-1).
 *
 * `register()` runs once per server instance and loads the Sentry config for
 * whichever runtime this is. `onRequestError` is Next's own hook for a
 * request that failed anywhere on the server (a Server Component render, a
 * Server Action, a route handler, the proxy) and Sentry's handler turns each
 * into exactly one event.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
