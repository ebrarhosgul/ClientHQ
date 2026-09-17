/**
 * What an action says when Clerk fails (spec 0015, AC-11), and what it logs.
 * Three messages, decided by the spec: busy (a 429), a failure before the
 * write (nothing changed), and a failure on the write itself (the change may
 * or may not have applied).
 */
import type { ClerkFailure } from "@/auth/clerk";
import { tenantActionError, type ActionError } from "@/db/tenant";

export type ClerkPhase = "read" | "write";

export const BUSY_MESSAGE = "The team service is busy. Try again in a minute.";
export const READ_FAILED_MESSAGE =
  "The team service could not be reached. Nothing was changed.";
export const WRITE_FAILED_MESSAGE =
  "The team service could not be reached. The change may or may not have applied; reload the page to check.";

/** The log outcome for a Clerk failure, so the line records which it was. */
export function unavailableOutcome(
  failure: ClerkFailure,
  phase: ClerkPhase,
): string {
  if (failure === "rate_limited") {
    return "unavailable_busy";
  }

  return phase === "read" ? "unavailable_read" : "unavailable_write";
}

export function unavailableError(
  failure: ClerkFailure,
  phase: ClerkPhase,
): ActionError {
  if (failure === "rate_limited") {
    return { code: "unavailable", message: BUSY_MESSAGE };
  }

  return {
    code: "unavailable",
    message: phase === "read" ? READ_FAILED_MESSAGE : WRITE_FAILED_MESSAGE,
  };
}

/** Throw the action error for a Clerk failure, after the caller has logged. */
export function throwUnavailable(
  failure: ClerkFailure,
  phase: ClerkPhase,
): never {
  throw tenantActionError(unavailableError(failure, phase));
}
