"use server";

/**
 * Creating an agency.
 *
 * The one write in this feature, and the only place a person supplies anything
 * at all: a single name, parsed by Zod at the boundary (spec 0005, AC-8).
 *
 * Not a `withTenantAction()`. That wrapper resolves a `StaffContext` before the
 * handler runs, and the whole point of this action is that the caller has no
 * organization yet, so there is no tenant to scope to. It returns the same
 * `Result` shape and the same closed set of error codes, so the form handles it
 * exactly like any other action.
 *
 * Order is fixed by the schema, not by taste: `organizations.clerk_org_id` is
 * not null and unique, so there is no valid local row to write before Clerk has
 * the organization. Clerk first, then all three local rows in one transaction.
 */
import { flattenError, z } from "zod";

import {
  consume,
  createAgencyRows,
  deletedOrganizationClerkIds,
  failure,
  ok,
  suggestedSlug,
  type ActionErrorCode,
  type FieldErrors,
  type Result,
} from "@/db/tenant";
import { sessionClaims } from "@/db/tenant/session";
import { CREATE_AGENCY } from "@/rate-limit/policies";

import { agencyMemberships, clerkUser, createClerkOrganization } from "./clerk";

/**
 * What a person sees when Clerk has the agency but the local rows did not land.
 *
 * It says the true thing: their agency exists, and opening it again finishes
 * the job, because the next agency request repairs the mirror from Clerk
 * (AC-11, AC-12). "Something went wrong" would be both less useful and less
 * accurate.
 */
const RETRY_MESSAGE =
  "Your agency was created, but finishing its setup did not complete. Try again and it will pick up where it left off.";

const createAgencyInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your agency's name.")
    .max(100, "Use 100 characters or fewer."),
});

/** A unique or check constraint, as the postgres-js driver reports it. */
function isConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  const code = (error as { readonly code: unknown }).code;
  return code === "23505" || code === "23514";
}

export type CreatedAgency = {
  /**
   * The organization to activate. Activation is a client call: `setActive()`
   * writes the session cookie in the browser, and the page waits for it to
   * resolve before navigating so the redirect never outruns it (AC-6, AC-9).
   */
  readonly clerkOrgId: string;
  /** True when this was an existing agency rather than a new one (AC-9). */
  readonly alreadyExisted: boolean;
};

export async function createAgency(
  input: unknown,
): Promise<Result<CreatedAgency>> {
  const parsed = createAgencyInput.safeParse(input);

  if (!parsed.success) {
    return failure({
      code: "validation",
      message: "",
      fieldErrors: flattenError(parsed.error).fieldErrors as FieldErrors,
    });
  }

  const { clerkUserId } = await sessionClaims();

  if (clerkUserId === undefined) {
    return failure({ code: "unauthenticated", message: "" });
  }

  const { name } = parsed.data;

  // Everything Clerk is asked for, in one place, so any Clerk failure becomes
  // one honest "try again" rather than an error page (AC-11).
  const prepared = await withClerk(async () => {
    // The double submit guard (AC-9). A retried or double clicked submit finds
    // the membership its first attempt created and activates that agency
    // instead of minting a second one. Read from Clerk, never from the local
    // `memberships` table, which may not have been written yet.
    //
    // A membership Clerk still lists but whose local mirror is soft deleted
    // (AC-14) does not count as existing, the same amendment `/onboarding`
    // makes: `repairMirror()` never clears `deleted_at`, so activating it
    // would resolve as missing on `/dashboard` and bounce back here forever.
    const memberships = await agencyMemberships(clerkUserId);
    const deletedClerkOrgIds = await deletedOrganizationClerkIds(
      memberships.map((membership) => membership.clerkOrgId),
    );
    const [existing] = memberships.filter(
      (membership) => !deletedClerkOrgIds.has(membership.clerkOrgId),
    );

    if (existing !== undefined) {
      return { kind: "existing" as const, clerkOrgId: existing.clerkOrgId };
    }

    const user = await clerkUser(clerkUserId);

    if (!user.ok) {
      return { kind: "gone" as const };
    }

    // Immediately before the one call that actually creates something (AC-6):
    // a double submit that resolved to an existing agency above never reaches
    // here, so it costs nothing, and no Clerk organization is ever created
    // past the ceiling.
    const verdict = await consume(
      { kind: "user", id: clerkUserId },
      CREATE_AGENCY,
      new Date(),
    );

    if (!verdict.allowed) {
      return { kind: "rate_limited" as const, message: verdict.message };
    }

    const created = await createClerkOrganization({
      name,
      slug: await suggestedSlug(name),
      createdBy: clerkUserId,
    });

    return { kind: "created" as const, clerkOrgId: created.clerkOrgId, user };
  });

  if (!prepared.ok) {
    return failure(prepared.error);
  }

  if (prepared.data.kind === "gone") {
    return failure({ code: "unauthenticated", message: "" });
  }

  if (prepared.data.kind === "rate_limited") {
    return failure({ code: "rate_limited", message: prepared.data.message });
  }

  if (prepared.data.kind === "existing") {
    return ok({ clerkOrgId: prepared.data.clerkOrgId, alreadyExisted: true });
  }

  const { clerkOrgId, user } = prepared.data;

  try {
    await createAgencyRows({ clerkOrgId, name }, user.data);
  } catch (error) {
    // The Clerk organization exists and the local rows do not. Nothing partial
    // was committed, the person is told to try again, and their next agency
    // request heals the mirror from Clerk (AC-11, AC-12). A slug race is the
    // one failure with a name of its own, because it is the one the repair is
    // specifically built to resolve differently the second time (AC-10).
    const code: ActionErrorCode = isConstraintViolation(error)
      ? "conflict"
      : "unavailable";

    return failure({ code, message: RETRY_MESSAGE });
  }

  return ok({ clerkOrgId, alreadyExisted: false });
}

/**
 * Run the Clerk calls, turning an outage into a result rather than a crash.
 *
 * Clerk being unreachable is a thing a person can act on ("try again"), not a
 * bug, so it is returned as a value the way the project returns every other
 * expected failure.
 */
async function withClerk<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    // A constraint violation from `suggestedSlug`'s read cannot happen, so
    // anything thrown in here came from Clerk or from the network.
    console.error("[clerk] agency creation failed", error);

    return failure({
      code: "unavailable",
      message:
        "We could not reach the accounts service. Try again in a moment.",
    });
  }
}
