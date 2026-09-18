/**
 * The observability keys (spec 0019), declared in `env.ts`'s schema and read
 * here.
 *
 * A separate module rather than a function beside `env()`, so a test that
 * stubs `@/lib/env` for its own feature does not have to know that analytics
 * runs underneath it: this file is what `src/analytics/` and
 * `src/observability/` import, and nothing else needs to.
 *
 * Read straight from `process.env` for the same reason `isClerkConfigured`
 * and `isR2Configured` are: `env()` throws when a
 * required key is missing, and the Sentry server config runs from
 * `instrumentation.ts`'s `register()` at boot, before anything has decided
 * whether the rest of the environment is complete. The browser suite in CI
 * boots with no Clerk credentials at all, and observability being off must
 * never turn that into a crash (spec 0019, AC-21). Every value here is
 * optional in the schema, so reading it this way loses no validation.
 *
 * The browser bundle cannot use this: Next only inlines a `NEXT_PUBLIC_`
 * variable written out in full at its call site, which is why
 * `src/instrumentation-client.ts` and `src/analytics/provider.tsx` spell
 * theirs out instead of importing from here.
 */
export type ObservabilityEnv = {
  readonly sentryDsn: string | undefined;
  readonly posthogKey: string | undefined;
  readonly posthogHost: string;
  readonly posthogPersonalApiKey: string | undefined;
  readonly posthogProjectId: string | undefined;
  readonly vercelEnv: string | undefined;
  readonly commitSha: string | undefined;
  readonly nodeEnv: string | undefined;
};

export function observabilityEnv(): ObservabilityEnv {
  return {
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined,
    posthogHost:
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    posthogPersonalApiKey: process.env.POSTHOG_PERSONAL_API_KEY || undefined,
    posthogProjectId: process.env.POSTHOG_PROJECT_ID || undefined,
    vercelEnv: process.env.VERCEL_ENV || undefined,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    nodeEnv: process.env.NODE_ENV || undefined,
  };
}
