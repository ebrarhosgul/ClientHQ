"use server";

/**
 * Choosing which accepted `client_contacts` row to act as (spec 0014, AC-11).
 *
 * Outside `withTenantAction()`, like `acceptInvitation`: the contact context
 * is already resolved by the time this runs (the switcher only renders inside
 * the portal), so it reuses `contactContext()` rather than re-deriving one.
 * The only input is an id, and it is checked against this person's own
 * accepted rows before anything is trusted: a row that is not theirs, or one
 * that has since been unaccepted, is `not_found`, exactly as a forged id
 * would be, so nothing here reveals which case applied.
 *
 * `redirect()` throws a signal Next handles, so it is called outside the
 * `try`-less success path, after the cookie is set; the function only ever
 * returns a `Result` on refusal.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  contactContext,
  failure,
  listAcceptedContactRows,
  type Result,
} from "@/db/tenant";
import { CONTACT_COOKIE_NAME } from "@/db/tenant/session";

import { SWITCH_REFUSED } from "./copy";
import { switchContactInput } from "./schema";

/** One year, in seconds: the same lifetime `acceptInvitation` gives the cookie. */
const CONTACT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** One line per refusal (AC-11), never on success: the cookie change is silent. */
function logSwitchRefused(userId: string): void {
  console.warn(
    JSON.stringify({
      event: "portal.switch.refused",
      userId,
      at: new Date().toISOString(),
    }),
  );
}

/** Switch to `contactId`, redirecting to `/portal` on success. */
export async function switchContact(input: unknown): Promise<Result<never>> {
  const parsed = switchContactInput.safeParse(input);

  if (!parsed.success) {
    return failure({
      code: "validation",
      message: "That is not a client you can switch to.",
    });
  }

  const ctx = await contactContext();
  const rows = await listAcceptedContactRows(ctx.userId);
  const chosen = rows.find((row) => row.contactId === parsed.data.contactId);

  if (chosen === undefined) {
    logSwitchRefused(ctx.userId);

    return failure({ code: "not_found", message: SWITCH_REFUSED });
  }

  const jar = await cookies();

  jar.set(CONTACT_COOKIE_NAME, chosen.contactId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: CONTACT_COOKIE_MAX_AGE,
  });

  redirect("/portal");
}
