/**
 * Sentry in the browser (spec 0019, AC-1, AC-2, AC-5).
 *
 * The two `NEXT_PUBLIC_` reads are spelled out in full rather than going
 * through `src/lib/env.ts`, because Next only inlines a public variable into
 * the browser bundle when it is written this way (the same exemption
 * `isClerkConfigured` has). Nothing else about the environment is visible
 * here, and nothing else is needed.
 *
 * Session replay is buffered in memory and sent only when an error happens,
 * with every text, input and media element masked, in every environment
 * where the SDK sends at all and regardless of the consent cookie: it holds
 * no personal data by construction. The integration is loaded lazily so it
 * stays out of the first paint bundle.
 */
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/observability/sentry-options";

const options = sentryOptions("browser", {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV || undefined,
  commitSha: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
});

Sentry.init({
  ...options,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
});

if (options.enabled) {
  // Lazy: the replay bundle is large and only matters once an error occurs.
  Sentry.lazyLoadIntegration("replayIntegration")
    .then((replayIntegration) => {
      Sentry.addIntegration(
        replayIntegration({
          maskAllText: true,
          maskAllInputs: true,
          blockAllMedia: true,
        }),
      );
    })
    .catch(() => {
      // Replay failing to load is never worth surfacing (AC-21).
    });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
