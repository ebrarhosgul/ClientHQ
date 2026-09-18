/**
 * The second writer of `organizations`, `users` and `memberships` (spec 0015),
 * on the same six step shape `src/payments/webhook.ts` built for Stripe:
 *
 * 1. **Verify the signature against the raw body**, before anything is parsed.
 *    A failure is 400 and writes nothing at all, ledger row included.
 * 2. **Resolve which object the event names.** An identifier is a pointer,
 *    never state; everything that ends up in a column is re read in step 3.
 * 3. **Re read the object from Clerk, outside any transaction.** Present or
 *    gone is the only thing step 5 needs to know, which is what makes a
 *    replayed or out of order delivery harmless.
 * 4. **Insert the ledger row with conflict-do-nothing.** Nothing inserted
 *    means this event was already handled: commit and answer 200 duplicate.
 * 5. **Lock and apply.** Unlike Stripe's explicit `for update` select, the
 *    write itself is the lock here (AC-12): the organization or user upsert
 *    locks its row for the rest of the transaction, and a membership event's
 *    two upserts run first so its own write follows behind that lock.
 * 6. **Commit.** Ledger row and mirror change together or not at all.
 *
 * The other structural difference from Stripe: an event here is a pointer to
 * one of three *kinds* of object (user, organization, membership), and the
 * event's `.created` / `.updated` / `.deleted` suffix never decides the
 * action. Only the re read does: present means upsert, gone means delete.
 * `organization.deleted` and a `user.updated` for someone Clerk 404s on take
 * the identical delete branch.
 *
 * Almost nothing answers 500 for the same reason it does not on the Stripe
 * side: Clerk disables an endpoint that keeps failing, and a disabled
 * endpoint means a mirror that silently freezes. 500 means only "this might
 * work on retry" - a database error, a Clerk API timeout or rate limit, or a
 * payload or re read that fails its Zod parse (Clerk's shapes moved, and
 * that is worth the retries and the loud failure).
 */
import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import {
  organizations,
  processedWebhookEvents,
  subscriptions,
  users,
} from "@/db/schema";
import type { Database, Executor } from "@/db/tenant";
import {
  deleteMembershipRows,
  ensureUserRow,
  MirrorUserDeleted,
  softDeleteOrganization,
  toMembershipRole,
  unbindContactsOfUser,
  upsertMembershipRow,
  upsertOrganizationRow,
} from "@/db/tenant";
import { env } from "@/lib/env";
import { newId } from "@/lib/id";
import { scrubUser } from "@/lib/scrub";
import { afterResponse, analytics } from "@/analytics";
import { reportException } from "@/observability";

import type { ClerkGateway } from "./clerk";
import {
  reportMembershipChange,
  type MembershipChange,
} from "./membership-analytics";
import {
  membershipEventData,
  membershipRoleRead,
  mirrorOrganizationRead,
  mirrorUserRead,
  organizationEventData,
  userEventData,
} from "./webhook-events";
import { logClerkWebhook, type ClerkWebhookOutcome } from "./webhook-log";

/**
 * The eight events this endpoint is subscribed to, and the only ones it acts
 * on. `user.created` is deliberately absent (spec 0001's amendment): this
 * mirror never creates a row for a person it has not met through a
 * membership, so there is nothing for that event to do.
 */
export const CLERK_WEBHOOK_EVENTS = [
  "user.updated",
  "user.deleted",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "organizationMembership.created",
  "organizationMembership.updated",
  "organizationMembership.deleted",
] as const;

export type ClerkWebhookEventType = (typeof CLERK_WEBHOOK_EVENTS)[number];

function isHandledEvent(type: string): type is ClerkWebhookEventType {
  return (CLERK_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

export type ClerkWebhookRequest = {
  readonly db: Database;
  readonly gateway: ClerkGateway;
  /**
   * The untouched request. `verifyWebhook` reads its body itself, and it is
   * `@clerk/nextjs/webhooks`'s own `RequestLike`, not the platform `Request`
   * `handleStripeWebhook` takes: the Next.js wrapper narrows to a Next.js
   * request so it can also read the framework's own header helpers.
   */
  readonly request: NextRequest;
};

export type ClerkWebhookResult = {
  readonly status: 200 | 400 | 500;
  readonly outcome: ClerkWebhookOutcome;
  /** Why, in a couple of words. Mirrors what was logged. */
  readonly reason: string;
};

/**
 * A refusal: something this event can never do, however many times Clerk
 * sends it. Thrown so it unwinds the transaction, then answered 200.
 */
class WebhookRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "WebhookRefusal";
  }
}

/** A PostgreSQL unique violation. Never transient, so never a 500. */
function isUniqueViolation(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    "code" in thrown &&
    (thrown as { readonly code?: unknown }).code === "23505"
  );
}

/** What this event points at, read off the payload (never state). */
type Reference =
  | { readonly kind: "user"; readonly clerkUserId: string }
  | { readonly kind: "organization"; readonly clerkOrgId: string }
  | {
      readonly kind: "membership";
      readonly clerkOrgId: string;
      readonly clerkUserId: string;
    };

function referenceOf(event: WebhookEvent): Reference {
  if (event.type.startsWith("organizationMembership.")) {
    const data = membershipEventData.parse(event.data);

    return {
      kind: "membership",
      clerkOrgId: data.organization.id,
      clerkUserId: data.public_user_data.user_id,
    };
  }

  if (event.type.startsWith("organization.")) {
    return {
      kind: "organization",
      clerkOrgId: organizationEventData.parse(event.data).id,
    };
  }

  return { kind: "user", clerkUserId: userEventData.parse(event.data).id };
}

type LogContext = {
  readonly eventId: string | undefined;
  readonly eventType: string | undefined;
  readonly clerkOrgId?: string;
  readonly clerkUserId?: string;
};

/** Log and answer. Every non `handled` outcome leaves exactly one line. */
function answer(
  result: ClerkWebhookResult,
  ctx: LogContext,
): ClerkWebhookResult {
  if (result.outcome !== "handled") {
    logClerkWebhook({
      outcome: result.outcome,
      eventId: ctx.eventId,
      eventType: ctx.eventType,
      clerkOrgId: ctx.clerkOrgId,
      clerkUserId: ctx.clerkUserId,
      reason: result.reason,
    });
  }

  return result;
}

/** Step 4: claim the delivery, inside the open transaction. */
async function claim(
  tx: Executor,
  svixId: string,
  eventType: string,
): Promise<"claimed" | "duplicate"> {
  const claimed = await tx
    .insert(processedWebhookEvents)
    .values({ id: newId(), source: "clerk", eventId: svixId, eventType })
    .onConflictDoNothing({
      target: [processedWebhookEvents.source, processedWebhookEvents.eventId],
    })
    .returning({ id: processedWebhookEvents.id });

  return claimed.length === 0 ? "duplicate" : "claimed";
}

/**
 * A user event: re read outside the transaction, then applied inside it.
 * Present updates a known row only (AC-8); gone scrubs a known row only
 * (AC-9). A stranger, either way, is answered `ignored` and nothing is
 * written: this mirror never creates a `users` row from a user event.
 */
async function applyUserEvent(
  db: Database,
  gateway: ClerkGateway,
  svixId: string,
  eventType: string,
  clerkUserId: string,
): Promise<ClerkWebhookResult> {
  const presence = await gateway.getUser(clerkUserId);
  const mirrorUser = presence.present
    ? mirrorUserRead.parse(presence.value)
    : undefined;

  return db.transaction(async (tx) => {
    if ((await claim(tx, svixId, eventType)) === "duplicate") {
      return {
        status: 200,
        outcome: "duplicate",
        reason: "already_processed",
      } as const;
    }

    const [existing] = await tx
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (existing === undefined) {
      return { status: 200, outcome: "ignored", reason: "stranger" } as const;
    }

    if (mirrorUser !== undefined) {
      if (existing.deletedAt !== null) {
        throw new WebhookRefusal("user_deleted");
      }

      try {
        await ensureUserRow(mirrorUser, tx);
      } catch (thrown) {
        // Defence in depth: a scrub racing this update between the select
        // above and here is caught by `ensureUserRow`'s own guard.
        if (thrown instanceof MirrorUserDeleted) {
          throw new WebhookRefusal("user_deleted");
        }

        throw thrown;
      }

      return { status: 200, outcome: "handled", reason: "applied" } as const;
    }

    if (existing.deletedAt !== null) {
      return {
        status: 200,
        outcome: "handled",
        reason: "already_scrubbed",
      } as const;
    }

    await scrubUser(tx, existing.id);
    await deleteMembershipRows({ userId: existing.id }, tx);
    await unbindContactsOfUser({ userId: existing.id }, tx);

    // Erased at the provider by the same delivery that scrubbed locally
    // (spec 0019, AC-20), once the response is out; the nightly
    // `analytics_erasure` sweep retries anything this misses.
    afterResponse(() =>
      analytics()
        .deletePerson(clerkUserId)
        .then(() => undefined),
    );

    return { status: 200, outcome: "handled", reason: "applied" } as const;
  });
}

/**
 * An organization event. Present always upserts, creating the row if this is
 * the first the product has heard of that agency (AC-5). Gone soft deletes a
 * known row and logs the subscription status itself (AC-6); an organization
 * this mirror never held is `ignored`.
 */
async function applyOrganizationEvent(
  db: Database,
  gateway: ClerkGateway,
  svixId: string,
  eventType: string,
  clerkOrgId: string,
): Promise<ClerkWebhookResult> {
  const presence = await gateway.getOrganization(clerkOrgId);
  const mirrorOrg = presence.present
    ? mirrorOrganizationRead.parse(presence.value)
    : undefined;

  return db.transaction(async (tx) => {
    if ((await claim(tx, svixId, eventType)) === "duplicate") {
      return {
        status: 200,
        outcome: "duplicate",
        reason: "already_processed",
      } as const;
    }

    if (mirrorOrg !== undefined) {
      const result = await upsertOrganizationRow(mirrorOrg, tx);

      if (result === "deleted") {
        throw new WebhookRefusal("org_deleted");
      }

      return { status: 200, outcome: "handled", reason: "applied" } as const;
    }

    const result = await softDeleteOrganization(clerkOrgId, tx);

    if (result === "not_found") {
      return { status: 200, outcome: "ignored", reason: "stranger" } as const;
    }

    await deleteMembershipRows({ orgId: result.orgId }, tx);

    const [sub] = await tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, result.orgId))
      .limit(1);

    // The delete branch logs itself: `answer()` only logs a non `handled`
    // outcome, and a soft delete is handled (spec 0015, AC-6).
    logClerkWebhook({
      outcome: "handled",
      eventId: svixId,
      eventType,
      clerkOrgId,
      reason: `organization_deleted subscription_status=${sub?.status ?? "none"}`,
    });

    return {
      status: 200,
      outcome: "handled",
      reason: "organization_deleted",
    } as const;
  });
}

/**
 * A membership event. Always resolves the organization and user rows first,
 * through the same two upserts, creating either if this is the only mention
 * of it the product has ever had (AC-10) - the sole path on which this
 * webhook creates a `users` row. Present upserts the membership; gone
 * deletes exactly that `(org_id, user_id)` row, a no change if it never
 * existed (AC-11).
 */
async function applyMembershipEvent(
  db: Database,
  gateway: ClerkGateway,
  svixId: string,
  eventType: string,
  clerkOrgId: string,
  clerkUserId: string,
): Promise<ClerkWebhookResult> {
  const [membershipPresence, orgPresence, userPresence] = await Promise.all([
    gateway.getOrganizationMembership({ clerkOrgId, clerkUserId }),
    gateway.getOrganization(clerkOrgId),
    gateway.getUser(clerkUserId),
  ]);

  if (!orgPresence.present) {
    return {
      status: 200,
      outcome: "refused",
      reason: "org_missing_on_reread",
    };
  }

  if (!userPresence.present) {
    return {
      status: 200,
      outcome: "refused",
      reason: "user_missing_on_reread",
    };
  }

  const mirrorOrg = mirrorOrganizationRead.parse(orgPresence.value);
  const mirrorUser = mirrorUserRead.parse(userPresence.value);
  const role = membershipPresence.present
    ? toMembershipRole(membershipRoleRead.parse(membershipPresence.value).role)
    : undefined;

  const committed = await db.transaction(
    async (
      tx,
    ): Promise<{
      readonly result: ClerkWebhookResult;
      readonly change: MembershipChange | undefined;
    }> => {
      if ((await claim(tx, svixId, eventType)) === "duplicate") {
        return {
          result: {
            status: 200,
            outcome: "duplicate",
            reason: "already_processed",
          },
          change: undefined,
        };
      }

      // Always organization, then user, then membership (AC-10, AC-11),
      // matching `upsertMirror`'s own order so the two writers never disagree.
      const orgResult = await upsertOrganizationRow(mirrorOrg, tx);

      if (orgResult === "deleted") {
        throw new WebhookRefusal("org_deleted");
      }

      let userId: string;

      try {
        ({ userId } = await ensureUserRow(mirrorUser, tx));
      } catch (thrown) {
        if (thrown instanceof MirrorUserDeleted) {
          throw new WebhookRefusal("user_deleted");
        }

        throw thrown;
      }

      const applied = {
        status: 200,
        outcome: "handled",
        reason: "applied",
      } as const;
      const base = { orgId: orgResult.orgId, userId, clerkUserId };

      if (role !== undefined) {
        const { inserted } = await upsertMembershipRow(
          orgResult.orgId,
          userId,
          role,
          tx,
        );

        return {
          result: applied,
          change: { ...base, kind: inserted ? "joined" : "role", role },
        };
      }

      await deleteMembershipRows({ orgId: orgResult.orgId, userId }, tx);

      return { result: applied, change: { ...base, kind: "removed" } };
    },
  );

  if (committed.change !== undefined) {
    await reportMembershipChange(committed.change);
  }

  return committed.result;
}

function applyEvent(
  db: Database,
  gateway: ClerkGateway,
  svixId: string,
  eventType: string,
  reference: Reference,
): Promise<ClerkWebhookResult> {
  if (reference.kind === "user") {
    return applyUserEvent(
      db,
      gateway,
      svixId,
      eventType,
      reference.clerkUserId,
    );
  }

  if (reference.kind === "organization") {
    return applyOrganizationEvent(
      db,
      gateway,
      svixId,
      eventType,
      reference.clerkOrgId,
    );
  }

  return applyMembershipEvent(
    db,
    gateway,
    svixId,
    eventType,
    reference.clerkOrgId,
    reference.clerkUserId,
  );
}

/**
 * The local row a Clerk organization maps to, if any, read for the Sentry
 * tag on a failed delivery (spec 0019, AC-6). A user event names no
 * organization, and a read that itself fails simply leaves the tag off.
 */
async function localOrgIdOf(
  db: Database,
  reference: Reference,
): Promise<string | undefined> {
  if (reference.kind === "user") {
    return undefined;
  }

  try {
    const [row] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.clerkOrgId, reference.clerkOrgId))
      .limit(1);

    return row?.id;
  } catch {
    return undefined;
  }
}

/**
 * Handle one inbound Clerk webhook request.
 *
 * Takes its database handle and its Clerk re reads as arguments rather than
 * reaching for either, exactly like `handleStripeWebhook`: the route owns the
 * unscoped handle and this owns the ordering.
 */
export async function handleClerkWebhook(
  request: ClerkWebhookRequest,
): Promise<ClerkWebhookResult> {
  const { db, gateway, request: httpRequest } = request;

  // 1. Verify first. Nothing below this line runs on an unverified body.
  let verified: WebhookEvent;

  try {
    verified = await verifyWebhook(httpRequest, {
      signingSecret: env().CLERK_WEBHOOK_SIGNING_SECRET,
    });
  } catch {
    // Deliberately not logging the thrown message: it is derived from a body
    // nothing has vouched for.
    return answer(
      { status: 400, outcome: "unverified", reason: "bad_signature" },
      { eventId: undefined, eventType: undefined },
    );
  }

  // `verifyWebhook` throws when the svix-id header is missing, so it is
  // trustworthy on every path past this point.
  const svixId = httpRequest.headers.get("svix-id") ?? undefined;
  const baseCtx: LogContext = { eventId: svixId, eventType: verified.type };

  if (!isHandledEvent(verified.type)) {
    return answer(
      { status: 200, outcome: "ignored", reason: "unsubscribed_event_type" },
      baseCtx,
    );
  }

  if (svixId === undefined) {
    throw new Error("A verified Clerk event carried no svix-id header.");
  }

  let reference: Reference | undefined;

  try {
    // 2. What does it point at?
    reference = referenceOf(verified);

    const ctx: LogContext = {
      ...baseCtx,
      clerkOrgId: reference.kind !== "user" ? reference.clerkOrgId : undefined,
      clerkUserId:
        reference.kind !== "organization" ? reference.clerkUserId : undefined,
    };

    // 3-6: re read, ledger, lock and apply, commit.
    return answer(
      await applyEvent(db, gateway, svixId, verified.type, reference),
      ctx,
    );
  } catch (thrown) {
    if (thrown instanceof WebhookRefusal) {
      // Rolled back, ledger row included, so nothing half applied survives.
      return answer(
        { status: 200, outcome: "refused", reason: thrown.reason },
        baseCtx,
      );
    }

    if (isUniqueViolation(thrown)) {
      return answer(
        { status: 200, outcome: "refused", reason: "unique_violation" },
        baseCtx,
      );
    }

    // Everything else might work next time, and Clerk should try again. The
    // whole transaction rolled back, so the redelivery is processed rather
    // than skipped as a duplicate. Sentry hears about it first, tagged with
    // the agency when the event's organization maps to a local row (spec
    // 0019, AC-6).
    reportException(thrown, {
      tags: {
        org_id:
          reference === undefined
            ? undefined
            : await localOrgIdOf(db, reference),
      },
      fingerprint: ["clerk_webhook", verified.type],
    });

    return answer(
      {
        status: 500,
        outcome: "failed",
        reason: thrown instanceof Error ? thrown.message : "unknown_error",
      },
      baseCtx,
    );
  }
}
