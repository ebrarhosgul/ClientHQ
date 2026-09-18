/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-8
 *
 * The Clerk reconcile against real PostgreSQL, with Clerk itself faked
 * through the same `ClerkListGateway` interface `liveClerkListGateway()`
 * implements: the three passes, the "deleted" handling, the complete listing
 * rule per pass, and each removal.
 *
 * Two of this sweep's steps act on **every** local live organization or user,
 * not just what a test creates, so every case runs inside one transaction
 * that is rolled back afterwards (the shape `src/invoices/invoices.db.test.ts`
 * already uses): the reconcile sees the real seeded rows exactly as
 * production would, including running its removal logic against them, but
 * none of it is ever committed. Rolling back one savepoint at a time would
 * not do here, so the outer transaction is what gets discarded, in full,
 * every time.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  memberships,
  organizations,
  users,
  type MembershipRole,
} from "@/db/schema";
import type { Database, MirrorOrganization, MirrorUser } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import { clerkReconcileSweep, type ClerkListGateway } from "./reconcile";

loadEnvFiles();

// Two of this sweep's passes act on every local live organization or user in
// the shared database, not just what a test creates: real, remote round
// trips for however many real rows exist, all inside one transaction that
// rolls back. Slow by nature; the default timeout is not enough.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

const ROLLBACK = new Error("rollback");

/**
 * Everything in `run` happens inside one transaction that always rolls back:
 * the reconcile's removal steps act on every local live row, seed data
 * included, and only a transaction that never commits makes that safe to
 * exercise for real.
 */
async function inRollback(run: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await run(tx as unknown as Database);
      throw ROLLBACK;
    });
  } catch (thrown) {
    if (thrown !== ROLLBACK) {
      throw thrown;
    }
  }
}

async function makeOrg(
  tx: Database,
  patch: { readonly deletedAt?: Date } = {},
): Promise<{ readonly orgId: string; readonly clerkOrgId: string }> {
  const orgId = newId();
  const unique = tag();
  const clerkOrgId = `org_${unique}`;

  await tx.insert(organizations).values({
    id: orgId,
    clerkOrgId,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
    deletedAt: patch.deletedAt,
  });

  return { orgId, clerkOrgId };
}

async function makeUser(
  tx: Database,
  patch: { readonly deletedAt?: Date } = {},
): Promise<{ readonly userId: string; readonly clerkUserId: string }> {
  const userId = newId();
  const unique = tag();
  const clerkUserId = `user_${unique}`;

  await tx.insert(users).values({
    id: userId,
    clerkUserId,
    email: `${unique}@example.test`,
    name: "A user",
    deletedAt: patch.deletedAt,
  });

  return { userId, clerkUserId };
}

async function makeMembership(
  tx: Database,
  orgId: string,
  userId: string,
  role: MembershipRole = "member",
): Promise<void> {
  await tx.insert(memberships).values({ id: newId(), orgId, userId, role });
}

/** A client and one contact of it, bound to `userId`. */
async function makeBoundContact(
  tx: Database,
  orgId: string,
  userId: string,
): Promise<string> {
  const clientId = newId();
  await tx.insert(clients).values({ id: clientId, orgId, name: "A client" });

  const contactId = newId();
  await tx.insert(clientContacts).values({
    id: contactId,
    orgId,
    clientId,
    userId,
    email: `${tag()}@example.test`,
    name: "A contact",
    acceptedAt: new Date("2026-01-01T00:00:00Z"),
  });

  return contactId;
}

function mirrorOrg(
  clerkOrgId: string,
  name = "Some Agency",
): MirrorOrganization {
  return { clerkOrgId, name };
}

function mirrorUser(
  clerkUserId: string,
  patch: Partial<MirrorUser> = {},
): MirrorUser {
  return {
    clerkUserId,
    email: `${clerkUserId}@example.test`,
    name: "A member",
    imageUrl: undefined,
    ...patch,
  };
}

function mirrorMember(
  clerkUserId: string,
  role: MembershipRole = "member",
  patch: Partial<MirrorUser> = {},
): MirrorUser & { readonly role: MembershipRole } {
  return { ...mirrorUser(clerkUserId, patch), role };
}

type FakeGatewayInput = {
  readonly organizations?: readonly MirrorOrganization[];
  readonly memberships?: Readonly<
    Record<string, readonly (MirrorUser & { readonly role: MembershipRole })[]>
  >;
  readonly users?: readonly MirrorUser[];
  readonly throwOrganizationsAfter?: number;
  readonly throwMembershipsAfter?: Readonly<Record<string, number>>;
  readonly throwUsersAfter?: number;
};

function fakeGateway(input: FakeGatewayInput): ClerkListGateway {
  return {
    listOrganizations: async function* listOrganizations() {
      const items = input.organizations ?? [];

      for (const [index, org] of items.entries()) {
        if (input.throwOrganizationsAfter === index) {
          throw new Error("organizations list failed");
        }

        yield org;
      }
    },

    listOrganizationMemberships: (clerkOrgId: string) =>
      (async function* listOrganizationMemberships() {
        const items = input.memberships?.[clerkOrgId] ?? [];
        const throwAt = input.throwMembershipsAfter?.[clerkOrgId];

        for (const [index, member] of items.entries()) {
          if (throwAt === index) {
            throw new Error(`memberships list failed for ${clerkOrgId}`);
          }

          yield member;
        }
      })(),

    listUsers: async function* listUsers() {
      const items = input.users ?? [];

      for (const [index, user] of items.entries()) {
        if (input.throwUsersAfter === index) {
          throw new Error("users list failed");
        }

        yield user;
      }
    },
  };
}

const NOW = new Date("2026-06-15T03:00:00Z");

function run(tx: Database, gateway: ClerkListGateway) {
  return clerkReconcileSweep(gateway).run({
    db: tx,
    todayUtc: "2026-06-15",
    now: NOW,
  });
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("clerk_reconcile against real PostgreSQL", () => {
  it("creates a local organization Clerk lists that has none, with a derived slug", async () => {
    await inRollback(async (tx) => {
      const clerkOrgId = `org_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId, "Brand New Agency")],
        }),
      );

      expect(report.counts).toMatchObject({ skipped_deleted: 0 });

      const [row] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId));

      expect(row).toBeDefined();
      expect(row.name).toBe("Brand New Agency");
      expect(row.slug).toBeTruthy();
    });
  });

  it("creates a user and membership for a member Clerk lists that has neither locally", async () => {
    await inRollback(async (tx) => {
      const { orgId, clerkOrgId } = await makeOrg(tx);
      const clerkUserId = `user_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: {
            [clerkOrgId]: [mirrorMember(clerkUserId, "member")],
          },
          // A real Clerk member also appears in the overall user listing;
          // naming them here too is what keeps the separate users pass from
          // treating this brand new member as absent and scrubbing them.
          users: [mirrorUser(clerkUserId)],
        }),
      );

      expect(report.counts).toMatchObject({
        memberships_upserted: 1,
        skipped_scrubbed: 0,
      });

      const [userRow] = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(userRow).toBeDefined();

      const [membershipRow] = await tx
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.orgId, orgId), eq(memberships.userId, userRow.id)),
        );
      expect(membershipRow).toMatchObject({ role: "member" });
    });
  });

  it("removes a local membership absent from that organization's complete listing", async () => {
    await inRollback(async (tx) => {
      const { orgId, clerkOrgId } = await makeOrg(tx);
      const { userId } = await makeUser(tx);
      await makeMembership(tx, orgId, userId);

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: { [clerkOrgId]: [] },
        }),
      );

      expect(report.counts).toMatchObject({ memberships_removed: 1 });

      const rows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.orgId, orgId));
      expect(rows).toHaveLength(0);
    });
  });

  it("soft deletes a local live organization absent from a complete listing, removing its memberships and logging the subscription status", async () => {
    await inRollback(async (tx) => {
      const { orgId } = await makeOrg(tx);
      const { userId } = await makeUser(tx);
      await makeMembership(tx, orgId, userId);

      // No organizations at all: every local live one, this one included,
      // is absent from a listing that still completed.
      const report = await run(tx, fakeGateway({ organizations: [] }));

      expect(report.counts).toMatchObject({ listing_incomplete: false });
      expect(report.counts?.organizations_soft_deleted).toBeGreaterThanOrEqual(
        1,
      );

      const [row] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(row.deletedAt).not.toBeNull();

      const rows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.orgId, orgId));
      expect(rows).toHaveLength(0);
    });
  });

  it("scrubs a local live user absent from a complete user listing, removing memberships and unbinding contacts", async () => {
    await inRollback(async (tx) => {
      const { orgId, clerkOrgId } = await makeOrg(tx);
      const { userId, clerkUserId } = await makeUser(tx);
      await makeMembership(tx, orgId, userId);
      const contactId = await makeBoundContact(tx, orgId, userId);

      // The organization is listed and live, but the user listing names
      // nobody: the user pass, not the membership pass, is what scrubs them.
      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: { [clerkOrgId]: [] },
          users: [],
        }),
      );

      expect(report.counts?.users_scrubbed).toBeGreaterThanOrEqual(1);

      const [userRow] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId));
      expect(userRow.deletedAt).not.toBeNull();
      expect(userRow.email).toBe(`deleted+${userId}@invalid`);

      const membershipRows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.userId, userId));
      expect(membershipRows).toHaveLength(0);

      const [contactRow] = await tx
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, contactId));
      expect(contactRow.userId).toBeNull();
      expect(contactRow.acceptedAt).toBeNull();

      expect(clerkUserId).toBeTruthy();
    });
  });

  it("counts a scrubbed user who reappears in a membership list as skipped_scrubbed, and leaves them scrubbed", async () => {
    await inRollback(async (tx) => {
      const { orgId, clerkOrgId } = await makeOrg(tx);
      const scrubbedAt = new Date("2026-05-01T00:00:00Z");
      const { userId, clerkUserId } = await makeUser(tx, {
        deletedAt: scrubbedAt,
      });

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: { [clerkOrgId]: [mirrorMember(clerkUserId)] },
        }),
      );

      expect(report.counts).toMatchObject({
        skipped_scrubbed: 1,
        memberships_upserted: 0,
      });

      const [userRow] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId));
      expect(userRow.deletedAt).toEqual(scrubbedAt);

      const rows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.orgId, orgId));
      expect(rows).toHaveLength(0);
    });
  });

  it("creates no row for a listed user with no local row and no membership", async () => {
    await inRollback(async (tx) => {
      const clerkUserId = `user_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({ organizations: [], users: [mirrorUser(clerkUserId)] }),
      );

      expect(report.counts).toMatchObject({ users_updated: 0 });

      const rows = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(rows).toHaveLength(0);
    });
  });

  it("counts a locally soft deleted organization Clerk still lists as skipped_deleted, and writes no membership for it", async () => {
    await inRollback(async (tx) => {
      const deletedAt = new Date("2026-04-01T00:00:00Z");
      const { orgId, clerkOrgId } = await makeOrg(tx, { deletedAt });
      const clerkUserId = `user_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: { [clerkOrgId]: [mirrorMember(clerkUserId)] },
        }),
      );

      expect(report.counts).toMatchObject({
        skipped_deleted: 1,
        memberships_upserted: 0,
      });

      const [row] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId));
      expect(row.deletedAt).toEqual(deletedAt);

      const [userRow] = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));
      expect(userRow).toBeUndefined();
    });
  });

  it("keeps the organizations upserted on page one when the listing fails on page two, and fails the sweep without soft deleting anything", async () => {
    await inRollback(async (tx) => {
      const survivorClerkOrgId = `org_${tag()}`;
      const orphanedClerkOrgId = `org_${tag()}`;
      const { orgId: untouchedOrgId } = await makeOrg(tx);

      const report = await run(
        tx,
        fakeGateway({
          organizations: [
            mirrorOrg(survivorClerkOrgId, "Page One Agency"),
            mirrorOrg(orphanedClerkOrgId, "Page Two Agency"),
          ],
          throwOrganizationsAfter: 1,
        }),
      );

      expect(report.outcome).toBe("failed");
      expect(report.counts).toMatchObject({
        organizations_upserted: 1,
        listing_incomplete: true,
      });

      const [survivor] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, survivorClerkOrgId));
      expect(survivor).toBeDefined();

      const [orphaned] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, orphanedClerkOrgId));
      expect(orphaned).toBeUndefined();

      // Nothing was soft deleted: the listing never completed.
      const [stillLive] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, untouchedOrgId));
      expect(stillLive.deletedAt).toBeNull();
    });
  });

  it("keeps memberships upserted before a page failure, removes none for that organization, and fails the sweep", async () => {
    await inRollback(async (tx) => {
      const { orgId, clerkOrgId } = await makeOrg(tx);
      const { userId: survivingUserId, clerkUserId: survivingClerkUserId } =
        await makeUser(tx);
      await makeMembership(tx, orgId, survivingUserId);

      const keptClerkUserId = `user_${tag()}`;
      const failedClerkUserId = `user_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({
          organizations: [mirrorOrg(clerkOrgId)],
          memberships: {
            [clerkOrgId]: [
              mirrorMember(keptClerkUserId),
              mirrorMember(failedClerkUserId),
            ],
          },
          throwMembershipsAfter: { [clerkOrgId]: 1 },
          // The pre-existing member also has to survive the separate users
          // pass, or its own scrub would remove the membership this case
          // means to prove untouched, for an unrelated reason.
          users: [
            mirrorUser(keptClerkUserId),
            mirrorUser(survivingClerkUserId),
          ],
        }),
      );

      expect(report.outcome).toBe("failed");
      expect(report.counts).toMatchObject({
        memberships_upserted: 1,
        memberships_removed: 0,
        listing_incomplete: true,
      });

      const [keptRow] = await tx
        .select()
        .from(users)
        .where(eq(users.clerkUserId, keptClerkUserId));
      expect(keptRow).toBeDefined();

      // The pre-existing membership is untouched: this organization's own
      // listing never completed, so nothing of its was removed.
      const [survivingMembership] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.userId, survivingUserId),
          ),
        );
      expect(survivingMembership).toBeDefined();
    });
  });

  it("keeps users updated before a page failure, scrubs nobody, and fails the sweep", async () => {
    await inRollback(async (tx) => {
      const { userId: keptUserId, clerkUserId: keptClerkUserId } =
        await makeUser(tx);
      const strangerClerkUserId = `user_${tag()}`;

      const report = await run(
        tx,
        fakeGateway({
          organizations: [],
          // A second item so the failure lands after the first is applied,
          // not before anything runs. It names nobody local, so it would be
          // ignored anyway; only its position (index 1) matters here.
          users: [
            mirrorUser(keptClerkUserId, { name: "Updated Name" }),
            mirrorUser(strangerClerkUserId),
          ],
          throwUsersAfter: 1,
        }),
      );

      expect(report.outcome).toBe("failed");
      expect(report.counts).toMatchObject({ listing_incomplete: true });
      expect(report.counts?.users_scrubbed).toBe(0);

      const [row] = await tx
        .select()
        .from(users)
        .where(eq(users.id, keptUserId));
      expect(row.name).toBe("Updated Name");
      expect(row.deletedAt).toBeNull();
    });
  });
});
