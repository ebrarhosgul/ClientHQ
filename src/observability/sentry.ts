/**
 * The Sentry calls the rest of the server makes, and the only ones (spec
 * 0019, AC-4, AC-6, AC-21).
 *
 * Each is a thin wrapper with two promises: it never throws into its caller,
 * and it is a no op when the SDK is off, so an invoice is issued exactly the
 * same way whether Sentry is up, down, or never configured. The SDK is
 * already quiet when disabled; the `try` is for the case nobody planned.
 *
 * Nothing here takes row contents. A tag is an id or a name; a message is a
 * fixed event name; the fingerprint is what groups each kind of signal into
 * one issue.
 */
import * as Sentry from "@sentry/nextjs";

import { isSentryConfigured } from "./configured";

export type SignalTags = {
  readonly org_id?: string;
  readonly [key: string]: string | undefined;
};

export type SignalOptions = {
  readonly level: "error" | "warning";
  readonly tags?: SignalTags;
  /** The same fields the log line carries, and never row contents. */
  readonly extra?: Readonly<Record<string, string | number | undefined>>;
  /** Grouped by these parts, so one kind of signal is one issue. */
  readonly fingerprint: readonly string[];
};

function definedTags(
  tags: SignalTags | undefined,
): Record<string, string> | undefined {
  if (tags === undefined) {
    return undefined;
  }

  const entries = Object.entries(tags).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );

  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function attempt<T>(fn: () => T): T | undefined {
  if (!isSentryConfigured()) {
    return undefined;
  }

  try {
    return fn();
  } catch {
    // A monitoring failure is never a product failure (AC-21).
    return undefined;
  }
}

/**
 * Stamp who this request is for, once per request, on the isolation scope
 * (AC-4). Called by the two context resolvers in `src/db/tenant/context.ts`,
 * the only places a Clerk session meets a local `orgId`.
 */
export function setTenantScope(scope: {
  readonly orgId: string;
  readonly clerkUserId: string;
}): void {
  attempt(() => {
    Sentry.setTag("org_id", scope.orgId);
    Sentry.setUser({ id: scope.clerkUserId });
  });
}

/** Promote a log signal to Sentry with the same fields the line carries. */
export function reportSignal(message: string, options: SignalOptions): void {
  attempt(() =>
    Sentry.captureMessage(message, {
      level: options.level,
      tags: definedTags(options.tags),
      extra: options.extra === undefined ? undefined : { ...options.extra },
      fingerprint: [...options.fingerprint],
    }),
  );
}

/** Capture a thrown error the caller is about to rethrow or answer 500 with. */
export function reportException(
  thrown: unknown,
  options: Omit<SignalOptions, "level">,
): void {
  attempt(() =>
    Sentry.captureException(thrown, {
      tags: definedTags(options.tags),
      fingerprint: [...options.fingerprint],
    }),
  );
}
