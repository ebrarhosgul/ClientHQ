/**
 * The consent choice as a value (spec 0019, AC-17): one first party cookie,
 * `clienthq_consent`, whose value is `accepted` or `declined`. Anything else,
 * a missing cookie included, reads as `undecided`.
 *
 * Pure, and shared by the server (the root layout reads the cookie, the
 * Server Action writes it) and the browser (the banner and the analytics
 * provider carry the state).
 */
import { z } from "zod";

export const CONSENT_COOKIE_NAME = "clienthq_consent";

/** One year, in seconds. */
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const consentChoice = z.enum(["accepted", "declined", "undecided"]);

export type ConsentState = z.infer<typeof consentChoice>;

/** A stored value that means a choice was made. */
const storedConsent = z.enum(["accepted", "declined"]);

export function readConsent(value: string | undefined): ConsentState {
  const parsed = storedConsent.safeParse(value);

  return parsed.success ? parsed.data : "undecided";
}
