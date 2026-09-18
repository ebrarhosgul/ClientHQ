/**
 * The three named ceilings, and nothing else (spec 0018, AC-1).
 *
 * Each is `as const`, and `RateLimitPolicy` is the union of exactly these
 * three literal types rather than a general `{ action, limit, windowSeconds }`
 * shape. That is what makes an ad hoc policy a type error rather than merely
 * an unlisted one: a hand written object has to match one of these three
 * literal shapes exactly, not just the field names (AC-13).
 *
 * No server imports here (the wrapper's config type needs this module, and
 * the wrapper is imported from client components).
 */

export const UPLOAD = {
  action: "upload",
  limit: 60,
  windowSeconds: 3600,
} as const;

export const INVOICE_EMAIL = {
  action: "invoice_email",
  limit: 50,
  windowSeconds: 86400,
} as const;

export const CREATE_AGENCY = {
  action: "create_agency",
  limit: 3,
  windowSeconds: 86400,
} as const;

export type RateLimitPolicy =
  typeof UPLOAD | typeof INVOICE_EMAIL | typeof CREATE_AGENCY;
