import type { ActionError, ActionErrorCode } from "@/db/tenant/errors";

/**
 * A plain sentence for every code a Server Action may return.
 *
 * `ACTION_ERROR_CODES` is a closed set, so this record is exhaustive by
 * construction: adding a code to that set fails the typecheck here until a
 * sentence exists for it. That is the point of keeping the map beside the UI
 * rather than letting each screen write its own wording.
 *
 * Nothing here names a constraint, a table or a driver. A person reading one of
 * these should learn what happened and what to do, and nothing about the shape
 * of the database.
 */
const MESSAGES: Readonly<Record<ActionErrorCode, string>> = {
  validation: "Some of what you entered needs another look.",
  unauthenticated: "You are signed out. Sign in and try again.",
  not_found: "That is not here any more. It may have been removed.",
  forbidden: "You do not have permission to do that.",
  conflict:
    "Someone changed this while you were working. Reload and try again.",
  rate_limited: "That is a lot of requests. Wait a moment and try again.",
  unavailable: "Your account is still being set up. Try again in a moment.",
};

/**
 * The sentence to show for a failure.
 *
 * A handler's own message wins when it has one, because it can say something
 * specific that a code cannot. The map is the floor, not the ceiling.
 */
export function errorMessage(error: ActionError): string {
  return error.message.trim() || MESSAGES[error.code];
}

/** The sentence for a code alone, where no `ActionError` is in hand. */
export function messageForCode(code: ActionErrorCode): string {
  return MESSAGES[code];
}
