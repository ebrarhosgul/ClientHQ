/**
 * The `Sentry.init` options every runtime shares (spec 0019, AC-2, AC-4,
 * AC-5), built in one place so the three config files differ only in what
 * is genuinely runtime specific (the replay integration in the browser).
 *
 * Quota is protected by configuration, not hope: a tenth of traces in
 * production and preview, none at all for the cron and webhook routes, whose
 * scheduled and retried traffic would otherwise burn it. Errors from those
 * routes are still captured; sampling only affects traces.
 */
import { scrubEvent } from "./sentry-scrub";
import { sentryEnabled, sentryEnvironment } from "./sentry-enabled";

export type SentryRuntime = "browser" | "node" | "edge";

export type SentryOptionsInput = {
  readonly dsn: string | undefined;
  readonly vercelEnv: string | undefined;
  readonly commitSha: string | undefined;
};

/** The one sampling rate spec 0019 fixes for production and preview. */
export const TRACES_SAMPLE_RATE = 0.1;

/** Route prefixes whose traces are never sampled (AC-5). */
const UNSAMPLED_PATHS = ["/api/cron", "/api/webhooks"] as const;

/**
 * A transaction is named by its route, sometimes with the method in front
 * (`POST /api/webhooks/stripe`), so the check strips an optional leading
 * method before looking at the path.
 */
export function isUnsampledTransaction(name: string): boolean {
  const path = name.replace(/^[A-Z]+\s+/, "");

  return UNSAMPLED_PATHS.some((prefix) => path.startsWith(prefix));
}

export function tracesSampler(context: { readonly name: string }): number {
  return isUnsampledTransaction(context.name) ? 0 : TRACES_SAMPLE_RATE;
}

export function sentryOptions(
  runtime: SentryRuntime,
  input: SentryOptionsInput,
) {
  return {
    dsn: input.dsn,
    enabled: sentryEnabled(input),
    environment: sentryEnvironment(input.vercelEnv),
    release: input.commitSha,
    // `sendDefaultPii` is left at its default of false and no `dataCollection`
    // object is passed (AC-4): the scrub below is the only privacy rule, and
    // it runs on every event and every transaction.
    tracesSampleRate: TRACES_SAMPLE_RATE,
    tracesSampler,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    initialScope: { tags: { runtime } },
  } as const;
}
