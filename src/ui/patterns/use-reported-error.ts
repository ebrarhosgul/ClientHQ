"use client";

/**
 * Report a boundary's error once and hand back the Sentry event id (spec
 * 0019, AC-7), so the boundary can show it as `Reference: <id>`.
 *
 * Runs once, when the boundary mounts, through a lazy state initialiser (an
 * effect that sets state is what the React lint rule refuses, and the
 * initialiser is exactly "once on mount"). Only when the SDK is enabled:
 * outside production and preview `isEnabled()` is false, nothing is captured
 * and the reference stays undefined, so the boundary shows nothing extra.
 * `captureException` returns the id it assigned, which is safer than reading
 * `lastEventId()` back after the fact.
 *
 * One of the few files allowed to import `@sentry/nextjs` directly (spec
 * 0019, key invariant 1): the server side wrappers in `src/observability/`
 * read the environment, which a client component cannot.
 */
import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

/** Capture once; never let reporting break the fallback it reports for. */
export function reportBoundaryError(error: Error): string | undefined {
  try {
    return Sentry.isEnabled() ? Sentry.captureException(error) : undefined;
  } catch {
    return undefined;
  }
}

export function useReportedError(error: Error): string | undefined {
  const [reference] = useState(() => reportBoundaryError(error));

  return reference;
}
