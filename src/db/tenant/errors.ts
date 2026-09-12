/**
 * The two error vocabularies of the tenant layer, in one place.
 *
 * Resolution failures are *thrown*, because a request with no tenant has no
 * business running a handler at all. Everything a Server Action can hand back
 * to a person is *returned* as a `Result`, because the browser has to render
 * it (spec 0003, AC-6 and AC-9).
 *
 * No classes here: a plain `Error` carrying a `kind` is enough, and the guard
 * below is what call sites use instead of `instanceof`.
 */

/** Why tenant context could not be resolved. Each carries no row data. */
export const RESOLUTION_ERROR_KINDS = [
  /** Nobody is signed in. */
  "no_session",
  /** Signed in, but no Clerk organization is selected. */
  "no_active_org",
  /** Clerk ids with no matching local `organizations` or `users` row. */
  "no_mirror_row",
  /** Signed in, but owns no `client_contacts` row. */
  "no_contact",
] as const;

export type ResolutionErrorKind = (typeof RESOLUTION_ERROR_KINDS)[number];

export type TenantResolutionError = Error & {
  readonly kind: ResolutionErrorKind;
};

/** Build the error the resolvers throw. */
export function tenantResolutionError(
  kind: ResolutionErrorKind,
): TenantResolutionError {
  return Object.assign(new Error(`tenant resolution failed: ${kind}`), {
    name: "TenantResolutionError",
    kind,
  });
}

export function isTenantResolutionError(
  value: unknown,
): value is TenantResolutionError {
  return (
    value instanceof Error &&
    "kind" in value &&
    RESOLUTION_ERROR_KINDS.includes(
      (value as { kind: ResolutionErrorKind }).kind,
    )
  );
}

/**
 * The closed set of codes a Server Action may return, so the UI can switch on
 * it exhaustively. A handler never invents one: the wrapper chooses.
 *
 * `rate_limited` is reserved for feature 19 and `unavailable` covers the case
 * where the local mirror row a signed in person needs has not landed yet.
 * `subscription_inactive` is the access gate's refusal (spec 0008, AC-6): the
 * agency's subscription does not allow a write right now, whoever is asking.
 */
export const ACTION_ERROR_CODES = [
  "validation",
  "unauthenticated",
  "not_found",
  "forbidden",
  "conflict",
  "rate_limited",
  "unavailable",
  "subscription_inactive",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

/** Zod's flattened field errors, present only on `validation`. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export type ActionError = {
  readonly code: ActionErrorCode;
  /** Safe to show a person. Never a constraint name or a driver message. */
  readonly message: string;
  readonly fieldErrors?: FieldErrors;
};

export type Result<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly error: ActionError };

export function ok<TData>(data: TData): Result<TData> {
  return { ok: true, data };
}

export function failure<TData>(error: ActionError): Result<TData> {
  return { ok: false, error };
}

/**
 * A refusal a handler or a guard raises deliberately, carrying the Result the
 * wrapper should hand back. Throwing it is the ergonomic way to leave a
 * handler early; every *other* throw propagates untouched, because an
 * unexpected exception is not a business outcome (AC-9).
 */
export type TenantActionError = Error & { readonly error: ActionError };

export function tenantActionError(error: ActionError): TenantActionError {
  return Object.assign(new Error(`${error.code}: ${error.message}`), {
    name: "TenantActionError",
    error,
  });
}

export function isTenantActionError(
  value: unknown,
): value is TenantActionError {
  return (
    value instanceof Error &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object"
  );
}
