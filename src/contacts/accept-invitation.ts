"use server";

/**
 * Accepting an invitation (spec 0009, AC-10).
 *
 * The one Server Action in the feature outside `withTenantAction()`, by
 * necessity: the person has no tenant yet. So it owns what the wrapper would
 * otherwise do, narrowly. It parses its one input, resolves the Clerk session
 * itself, asks the acceptance door to bind, and on success sets the contact
 * cookie spec 0003 already reads and sends the person to `/portal`.
 *
 * `redirect()` throws a signal Next handles, so it is called outside the
 * `try`; the `catch` names only the failures this action turns into a Result.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { clerkUser, clerkVerifiedEmails } from "@/auth/clerk";
import {
  acceptInvitation as bindInvitation,
  failure,
  type Result,
} from "@/db/tenant";
import { CONTACT_COOKIE_NAME, sessionClaims } from "@/db/tenant/session";

import { logContactEvent } from "./log";
import { parseToken } from "./token";

const acceptInput = z.object({ token: z.string().min(1) });

/** One year, in seconds. */
const CONTACT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const FORBIDDEN = {
  code: "forbidden",
  message: "This invitation cannot be accepted with this account.",
} as const;

/**
 * Accept the invitation named by `token`. Redirects on success, so the
 * returned promise only ever resolves to a failure.
 */
export async function acceptInvitation(input: unknown): Promise<Result<never>> {
  const parsed = acceptInput.safeParse(input);
  const token = parsed.success ? parseToken(parsed.data.token) : undefined;

  if (token === undefined) {
    logContactEvent({ operation: "accept", outcome: "malformed_token" });

    return failure(FORBIDDEN);
  }

  const { clerkUserId } = await sessionClaims();

  if (clerkUserId === undefined) {
    return failure({
      code: "unauthenticated",
      message: "Sign in to accept this invitation.",
    });
  }

  const [user, emails] = await Promise.all([
    clerkUser(clerkUserId),
    clerkVerifiedEmails(clerkUserId),
  ]);

  if (!user.ok || !emails.ok) {
    return failure({
      code: "unavailable",
      message: "Your account could not be checked. Try again in a moment.",
    });
  }

  const outcome = await bindInvitation(
    { token, clerkUserId, verifiedEmails: emails.data },
    user.data,
  );

  logContactEvent({
    operation: "accept",
    outcome: outcome.kind,
    orgId: outcome.orgId,
    contactId: outcome.contactId,
  });

  if (outcome.kind === "refused") {
    return failure(FORBIDDEN);
  }

  const jar = await cookies();

  jar.set(CONTACT_COOKIE_NAME, outcome.contactId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: CONTACT_COOKIE_MAX_AGE,
  });

  redirect("/portal");
}
