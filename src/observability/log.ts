/**
 * The log lines observability itself leaves (spec 0019, AC-20, AC-21), in
 * the one call, one line shape of `src/db/tenant/log.ts`. Names, event
 * names and error class names only: never an event's properties, never a
 * payload, never an address.
 */

export type ObservabilityLogLine =
  | {
      readonly event: "observability.unconfigured";
      readonly missing: readonly string[];
      readonly at: string;
    }
  | {
      readonly event: "analytics.failed";
      /** The analytics event or call that failed, e.g. `invoice.issued`. */
      readonly name: string;
      /** The thrown error's class name, never its message. */
      readonly errorName: string;
      readonly at: string;
    }
  | {
      readonly event: "analytics.erasure_failed";
      readonly clerkUserId: string;
      readonly errorName: string;
      readonly at: string;
    };

function emit(line: ObservabilityLogLine): void {
  console.warn(JSON.stringify(line));
}

export function logObservabilityUnconfigured(missing: readonly string[]): void {
  emit({
    event: "observability.unconfigured",
    missing,
    at: new Date().toISOString(),
  });
}

export function logAnalyticsFailed(name: string, thrown: unknown): void {
  emit({
    event: "analytics.failed",
    name,
    errorName: errorName(thrown),
    at: new Date().toISOString(),
  });
}

export function logErasureFailed(clerkUserId: string, thrown: unknown): void {
  emit({
    event: "analytics.erasure_failed",
    clerkUserId,
    errorName: errorName(thrown),
    at: new Date().toISOString(),
  });
}

/** The class name of whatever was thrown, and never its message. */
export function errorName(thrown: unknown): string {
  return thrown instanceof Error ? thrown.name : typeof thrown;
}
