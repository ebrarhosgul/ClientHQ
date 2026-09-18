"use server";

/**
 * The one write consent has (spec 0019, AC-17): a public Server Action that
 * sets, or with `undecided` deletes, the first party consent cookie. It
 * touches no database, needs no session, and parses its one input with Zod
 * before anything else. It is deliberately not a `withTenantAction`: a
 * signed out visitor on the sign in page has to be able to decline.
 */
import { cookies } from "next/headers";

import { failure, ok, type Result } from "@/db/tenant/errors";

import {
  CONSENT_COOKIE_MAX_AGE,
  CONSENT_COOKIE_NAME,
  consentChoice,
  type ConsentState,
} from "./consent-state";

export async function setCookieConsent(
  input: unknown,
): Promise<Result<{ readonly consent: ConsentState }>> {
  const parsed = consentChoice.safeParse(input);

  if (!parsed.success) {
    return failure({
      code: "validation",
      message: "That is not a choice this form knows.",
    });
  }

  const jar = await cookies();
  const choice = parsed.data;

  if (choice === "undecided") {
    jar.delete(CONSENT_COOKIE_NAME);
  } else {
    jar.set(CONSENT_COOKIE_NAME, choice, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV !== "development",
      path: "/",
      maxAge: CONSENT_COOKIE_MAX_AGE,
    });
  }

  return ok({ consent: choice });
}
