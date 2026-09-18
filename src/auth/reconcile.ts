/**
 * `clerk_reconcile`, the fifth nightly sweep (spec 0017, AC-8).
 *
 * Three passes, organizations then memberships then users, each independent
 * of the others' failures but the memberships pass depending on the
 * organizations pass having run: a membership only reconciles for a Clerk
 * organization this run has just confirmed is live. Every write goes through
 * the same functions the Clerk webhook uses (`src/db/tenant/provisioning.ts`
 * and `scrubUser`), so the two mirrors can never disagree about what one of
 * them wrote.
 *
 * Nothing is ever soft deleted, scrubbed or removed on the strength of a
 * listing that failed part way: each pass tracks whether its own listing (or,
 * for memberships, that organization's own listing) ran to the end, and the
 * removal half only runs when it did. The upsert half has no such gate,
 * because each object it touches is independent of the others (AC-8).
 */
import { eq, isNull } from "drizzle-orm";

import type { MembershipRole } from "@/db/schema";
import { memberships, organizations, subscriptions, users } from "@/db/schema";
import type { Database } from "@/db/tenant";
import {
  deleteMembershipRows,
  ensureUserRow,
  MirrorUserDeleted,
  softDeleteOrganization,
  unbindContactsOfUser,
  upsertMembershipRow,
  upsertOrganizationRow,
  type MirrorOrganization,
  type MirrorUser,
} from "@/db/tenant";
import { afterResponse, analytics } from "@/analytics";
import { scrubUser } from "@/lib/scrub";

import type { Sweep, SweepInput, SweepReport } from "@/cron/sweep";

import {
  reportMembershipChange,
  type MembershipChange,
} from "./membership-analytics";

export type ClerkListGateway = {
  /** Every Clerk organization, to the end. Throws on any page failure. */
  readonly listOrganizations: () => AsyncIterable<MirrorOrganization>;
  /**
   * Every membership of one organization, to the end, each carrying the full
   * mirror fields off the membership's own `publicUserData` (no per user
   * fetch). A member whose Clerk account no longer exists is left out, the
   * same skip `src/auth/clerk.ts`'s `organizationMembers` already makes.
   */
  readonly listOrganizationMemberships: (
    clerkOrgId: string,
  ) => AsyncIterable<MirrorUser & { readonly role: MembershipRole }>;
  /** Every Clerk user, to the end. */
  readonly listUsers: () => AsyncIterable<MirrorUser>;
};

function message(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** One line per item level write, error, or anomaly. Provider ids only. */
function logItem(event: string, fields: Record<string, unknown>): void {
  console.warn(
    JSON.stringify({
      event: `clerk_reconcile.${event}`,
      ...fields,
      at: new Date().toISOString(),
    }),
  );
}

/** Run `fn` in its own transaction; a throw is counted, never rethrown. */
async function attempt(
  db: Database,
  onError: (error: string) => void,
  fn: (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ) => Promise<void>,
): Promise<boolean> {
  try {
    await db.transaction(fn);
    return true;
  } catch (thrown) {
    onError(message(thrown));
    return false;
  }
}

type OrganizationsPassResult = {
  /** clerkOrgId → local orgId, live organizations only. */
  readonly live: ReadonlyMap<string, string>;
  readonly listedIds: ReadonlySet<string>;
  readonly complete: boolean;
  readonly upserted: number;
  readonly skippedDeleted: number;
  readonly errors: number;
};

async function runOrganizationsPass(
  db: Database,
  gateway: ClerkListGateway,
): Promise<OrganizationsPassResult> {
  const live = new Map<string, string>();
  const listedIds = new Set<string>();
  let upserted = 0;
  let skippedDeleted = 0;
  let errors = 0;
  let complete = false;

  try {
    for await (const org of gateway.listOrganizations()) {
      listedIds.add(org.clerkOrgId);

      let outcome: { readonly orgId: string } | "deleted" | undefined;

      const ok = await attempt(
        db,
        (error) => {
          errors += 1;
          logItem("error", { clerkOrgId: org.clerkOrgId, error });
        },
        async (tx) => {
          outcome = await upsertOrganizationRow(org, tx);
        },
      );

      if (!ok) {
        continue;
      }

      if (outcome === "deleted") {
        skippedDeleted += 1;
      } else if (outcome !== undefined) {
        live.set(org.clerkOrgId, outcome.orgId);
        upserted += 1;
      }
    }

    complete = true;
  } catch {
    // The listing itself failed part way; the upserts already applied stay
    // applied (AC-8), and the caller sees `complete: false`.
  }

  return { live, listedIds, complete, upserted, skippedDeleted, errors };
}

/**
 * Every local live organization Clerk's complete listing never mentioned,
 * soft deleted with its memberships, exactly as `organization.deleted`
 * would (spec 0015, AC-6).
 */
async function softDeleteMissingOrganizations(
  db: Database,
  listedIds: ReadonlySet<string>,
): Promise<{ readonly softDeleted: number; readonly errors: number }> {
  const localLive = await db
    .select({ clerkOrgId: organizations.clerkOrgId })
    .from(organizations)
    .where(isNull(organizations.deletedAt));

  const missing = localLive.filter((row) => !listedIds.has(row.clerkOrgId));

  let softDeleted = 0;
  let errors = 0;

  for (const row of missing) {
    const ok = await attempt(
      db,
      (error) => {
        errors += 1;
        logItem("error", { clerkOrgId: row.clerkOrgId, error });
      },
      async (tx) => {
        const result = await softDeleteOrganization(row.clerkOrgId, tx);

        if (result === "not_found") {
          return;
        }

        await deleteMembershipRows({ orgId: result.orgId }, tx);

        const [sub] = await tx
          .select({ status: subscriptions.status })
          .from(subscriptions)
          .where(eq(subscriptions.orgId, result.orgId))
          .limit(1);

        logItem("organization_soft_deleted", {
          orgId: result.orgId,
          clerkOrgId: row.clerkOrgId,
          subscriptionStatus: sub?.status ?? "none",
        });
      },
    );

    if (ok) {
      softDeleted += 1;
    }
  }

  return { softDeleted, errors };
}

type MembershipsPassResult = {
  readonly upserted: number;
  readonly removed: number;
  readonly skippedScrubbed: number;
  readonly errors: number;
  readonly anyIncomplete: boolean;
};

/** One live organization's memberships: upsert what is listed, then prune. */
async function runOneOrganizationMemberships(
  db: Database,
  gateway: ClerkListGateway,
  clerkOrgId: string,
  orgId: string,
): Promise<MembershipsPassResult> {
  const listedUserIds = new Set<string>();
  let upserted = 0;
  let skippedScrubbed = 0;
  let errors = 0;
  let complete = false;

  try {
    for await (const member of gateway.listOrganizationMemberships(
      clerkOrgId,
    )) {
      listedUserIds.add(member.clerkUserId);

      let scrubbed = false;
      let change: MembershipChange | undefined;

      const ok = await attempt(
        db,
        (error) => {
          errors += 1;
          logItem("error", {
            orgId,
            clerkUserId: member.clerkUserId,
            error,
          });
        },
        async (tx) => {
          let userId: string;

          try {
            ({ userId } = await ensureUserRow(member, tx));
          } catch (thrown) {
            if (thrown instanceof MirrorUserDeleted) {
              scrubbed = true;
              return;
            }

            throw thrown;
          }

          const { inserted } = await upsertMembershipRow(
            orgId,
            userId,
            member.role,
            tx,
          );

          change = {
            orgId,
            userId,
            clerkUserId: member.clerkUserId,
            kind: inserted ? "joined" : "role",
            role: member.role,
          };
        },
      );

      if (ok && scrubbed) {
        skippedScrubbed += 1;
      } else if (ok) {
        upserted += 1;

        // After the commit: a join the webhook missed is still counted once
        // (spec 0019, AC-12, AC-13).
        if (change !== undefined) {
          await reportMembershipChange(change);
        }
      }
    }

    complete = true;
  } catch {
    // This organization's membership listing failed part way; the upserts
    // already applied stay applied, and nothing of its is removed below.
  }

  let removed = 0;

  if (complete) {
    const localRows = await db
      .select({ userId: memberships.userId, clerkUserId: users.clerkUserId })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.orgId, orgId));

    const missing = localRows.filter(
      (row) => !listedUserIds.has(row.clerkUserId),
    );

    for (const row of missing) {
      const ok = await attempt(
        db,
        (error) => {
          errors += 1;
          logItem("error", { orgId, userId: row.userId, error });
        },
        (tx) => deleteMembershipRows({ orgId, userId: row.userId }, tx),
      );

      if (ok) {
        removed += 1;
        await reportMembershipChange({
          orgId,
          userId: row.userId,
          clerkUserId: row.clerkUserId,
          kind: "removed",
        });
      }
    }
  }

  return {
    upserted,
    removed,
    skippedScrubbed,
    errors,
    anyIncomplete: !complete,
  };
}

async function runMembershipsPass(
  db: Database,
  gateway: ClerkListGateway,
  liveOrgs: ReadonlyMap<string, string>,
): Promise<MembershipsPassResult> {
  let upserted = 0;
  let removed = 0;
  let skippedScrubbed = 0;
  let errors = 0;
  let anyIncomplete = false;

  for (const [clerkOrgId, orgId] of liveOrgs) {
    const result = await runOneOrganizationMemberships(
      db,
      gateway,
      clerkOrgId,
      orgId,
    );

    upserted += result.upserted;
    removed += result.removed;
    skippedScrubbed += result.skippedScrubbed;
    errors += result.errors;
    anyIncomplete = anyIncomplete || result.anyIncomplete;
  }

  return { upserted, removed, skippedScrubbed, errors, anyIncomplete };
}

type UsersPassResult = {
  readonly updated: number;
  readonly scrubbed: number;
  readonly errors: number;
  readonly complete: boolean;
};

async function runUsersPass(
  db: Database,
  gateway: ClerkListGateway,
  now: Date,
): Promise<UsersPassResult> {
  const localLive = await db
    .select({ id: users.id, clerkUserId: users.clerkUserId })
    .from(users)
    .where(isNull(users.deletedAt));
  const localByClerkId = new Map(
    localLive.map((row) => [row.clerkUserId, row.id]),
  );

  const listedIds = new Set<string>();
  let updated = 0;
  let errors = 0;
  let complete = false;

  try {
    for await (const listed of gateway.listUsers()) {
      if (!localByClerkId.has(listed.clerkUserId)) {
        // A stranger to this listing pass: the reconcile never creates a
        // `users` row here, only a membership does (spec 0017, key invariants).
        continue;
      }

      listedIds.add(listed.clerkUserId);

      const ok = await attempt(
        db,
        (error) => {
          errors += 1;
          logItem("error", { clerkUserId: listed.clerkUserId, error });
        },
        async (tx) => {
          await ensureUserRow(listed, tx);
        },
      );

      if (ok) {
        updated += 1;
      }
    }

    complete = true;
  } catch {
    // The user listing failed part way; nothing below runs.
  }

  let scrubbed = 0;

  if (complete) {
    const missing = localLive.filter((row) => !listedIds.has(row.clerkUserId));

    for (const row of missing) {
      const ok = await attempt(
        db,
        (error) => {
          errors += 1;
          logItem("error", { clerkUserId: row.clerkUserId, error });
        },
        async (tx) => {
          await scrubUser(tx, row.id, now);
          await deleteMembershipRows({ userId: row.id }, tx);
          await unbindContactsOfUser({ userId: row.id }, tx);
        },
      );

      if (ok) {
        scrubbed += 1;
        // The provider side of the scrub (spec 0019, AC-20), queued for
        // after the response; `analytics_erasure` runs next and retries.
        afterResponse(() =>
          analytics()
            .deletePerson(row.clerkUserId)
            .then(() => undefined),
        );
      }
    }
  }

  return { updated, scrubbed, errors, complete };
}

async function run(
  gateway: ClerkListGateway,
  { db, now }: SweepInput,
): Promise<SweepReport> {
  const orgsPass = await runOrganizationsPass(db, gateway);

  const softDeletes = orgsPass.complete
    ? await softDeleteMissingOrganizations(db, orgsPass.listedIds)
    : { softDeleted: 0, errors: 0 };

  const membershipsPass = await runMembershipsPass(db, gateway, orgsPass.live);

  const usersPass = await runUsersPass(db, gateway, now);

  const errors =
    orgsPass.errors +
    softDeletes.errors +
    membershipsPass.errors +
    usersPass.errors;

  const listingIncomplete =
    !orgsPass.complete || membershipsPass.anyIncomplete || !usersPass.complete;

  return {
    // A listing failure ends the sweep failed too, even when every write
    // that did run succeeded: the writes already made are kept, but the
    // pass did not finish (spec 0017, AC-8).
    outcome: errors > 0 || listingIncomplete ? "failed" : "ok",
    counts: {
      organizations_upserted: orgsPass.upserted,
      organizations_soft_deleted: softDeletes.softDeleted,
      skipped_deleted: orgsPass.skippedDeleted,
      memberships_upserted: membershipsPass.upserted,
      memberships_removed: membershipsPass.removed,
      skipped_scrubbed: membershipsPass.skippedScrubbed,
      users_updated: usersPass.updated,
      users_scrubbed: usersPass.scrubbed,
      listing_incomplete: listingIncomplete,
      errors,
    },
  };
}

export function clerkReconcileSweep(gateway: ClerkListGateway): Sweep {
  return {
    name: "clerk_reconcile",
    run: (input) => run(gateway, input),
  };
}
