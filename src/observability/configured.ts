/**
 * Is either provider switched on (spec 0019, AC-21)?
 *
 * Both keys are optional in every environment. A missing one means every
 * call into that provider is a no op, and a production process says so
 * exactly once, naming the keys, so an empty dashboard has an explanation in
 * the logs rather than a mystery.
 */
import { observabilityEnv } from "@/lib/observability-env";

import { logObservabilityUnconfigured } from "./log";

// The one time guard, on the same terms as `env()`'s own cache: a module
// level `let` that only ever moves from false to true.
let unconfiguredReported = false;

function missingKeys(): readonly string[] {
  const { sentryDsn, posthogKey } = observabilityEnv();

  return [
    ...(sentryDsn === undefined ? ["NEXT_PUBLIC_SENTRY_DSN"] : []),
    ...(posthogKey === undefined ? ["NEXT_PUBLIC_POSTHOG_KEY"] : []),
  ];
}

/** Log the missing keys the first time a production process asks. */
function reportUnconfiguredOnce(): void {
  if (unconfiguredReported || observabilityEnv().nodeEnv !== "production") {
    return;
  }

  unconfiguredReported = true;

  const missing = missingKeys();

  if (missing.length > 0) {
    logObservabilityUnconfigured(missing);
  }
}

export function isSentryConfigured(): boolean {
  reportUnconfiguredOnce();

  return observabilityEnv().sentryDsn !== undefined;
}

export function isAnalyticsConfigured(): boolean {
  reportUnconfiguredOnce();

  return observabilityEnv().posthogKey !== undefined;
}

/** Person deletion needs the second, private pair (AC-20). */
export function isErasureConfigured(): boolean {
  const { posthogPersonalApiKey, posthogProjectId } = observabilityEnv();

  return posthogPersonalApiKey !== undefined && posthogProjectId !== undefined;
}

/** Test seam: forget that the one time line was written. */
export function resetUnconfiguredReportForTests(): void {
  unconfiguredReported = false;
}
