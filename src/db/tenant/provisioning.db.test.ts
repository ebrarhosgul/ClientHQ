/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-10, AC-12, AC-13, AC-14 · spec 0015 AC-6, AC-8, AC-9,
 * AC-11
 *
 * The mirror, against real SQL.
 *
 * These are the cases that only a database can answer: that three rows land in
 * one transaction, that writing them twice leaves one of each, that a second
 * agency with the same name gets its own slug instead of repeating a unique
 * violation, that a soft deleted organization stops resolving, and (spec 0015)
 * that the four doors the Clerk webhook shares with this file never revive or
 * rewrite a row this mirror has already erased.
 *
 * Everything runs inside a transaction that is rolled back, the same shape as
 * `tenancy.db.test.ts`, so the suite leaves the database exactly as it found it
 * and can be pointed at a development project as safely as at CI's container.
 *
 * **What this cannot cover**: genuine cross connection concurrency. Two callers
 * on one transaction are serialised by the driver, so the concurrent case below
 * proves the upsert is re-entrant rather than proving two web requests race
 * safely. The guarantee under a real race is the unique key plus
 * `onConflictDoUpdate`, and `verify.md` carries the manual check for it.
 * `src/auth/webhook.db.test.ts` covers a genuine cross connection race for the
 * webhook's own use of these functions.
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database.
 */
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import { loadEnvFiles } from "@/lib/load-env-files";

import * as schema from "../schema";
import {
  clientContacts,
  clients,
  memberships,
  organizations,
  users,
} from "../schema";
import { resolveStaffContext } from "./context";
import { isTenantResolutionError } from "./errors";
import type { TransactionExecutor } from "./executor";
import {
  createAgencyRows,
  deleteMembershipRows,
  ensureMirrorRows,
  ensureUserRow,
  MirrorUserDeleted,
  softDeleteOrganization,
  unbindContactsOfUser,
  upsertOrganizationRow,
} from "./provisioning";
import { newId } from "@/lib/id";

// The one module `context.ts` reads Clerk through, so a case sets what the
// session says without going near the SDK.
const session = vi.hoisted(() => ({
  claims: {
    clerkUserId: undefined as string | undefined,
    clerkOrgId: undefined as string | undefined,
    clerkOrgRole: undefined as string | undefined,
  },
}));

vi.mock("./session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => session.claims,
  contactCookie: async () => undefined,
}));

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

/** A Clerk id that no other run of this suite could have used. */
const clerkId = (prefix: string) =>
  `${prefix}_test_${Math.random().toString(36).slice(2, 12)}`;

async function inRollback(
  run: (tx: TransactionExecutor) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("provisioning against real PostgreSQL", () => {
  describe("createAgencyRows", () => {
    it("writes the organization, the user and the membership", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");

        const ids = await createAgencyRows(
          { clerkOrgId, name: "Northwind Studio" },
          {
            clerkUserId,
            email: "owner@northwind.test",
            name: "Ada Owner",
            imageUrl: "https://img.clerk.test/ada",
          },
          tx,
        );

        const [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, ids.orgId));
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, ids.userId));
        const [membership] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, ids.orgId),
              eq(memberships.userId, ids.userId),
            ),
          );

        expect(org?.name).toBe("Northwind Studio");
        expect(org?.slug).toBe("northwind-studio");
        expect(org?.clerkOrgId).toBe(clerkOrgId);
        // Spec 0002's column defaults, not set by provisioning.
        expect(org?.defaultCurrency).toBe("USD");
        expect(org?.nextInvoiceNumber).toBe(1);

        expect(user?.email).toBe("owner@northwind.test");
        expect(user?.name).toBe("Ada Owner");

        // The creator is `org:admin` at Clerk, so `admin` here.
        expect(membership?.role).toBe("admin");
      });
    });

    it("gives a second agency of the same name its own slug (AC-10)", async () => {
      await inRollback(async (tx) => {
        const first = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Northwind" },
          {
            clerkUserId: clerkId("user"),
            email: "one@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        const second = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Northwind" },
          {
            clerkUserId: clerkId("user"),
            email: "two@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        const rows = await tx
          .select({ id: organizations.id, slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, first.orgId));

        const [secondRow] = await tx
          .select({ slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, second.orgId));

        expect(rows[0]?.slug).toBe("northwind");
        // Suffixed rather than repeating the unique violation. This is the
        // failure the repair is specifically built to resolve differently.
        expect(secondRow?.slug).toBe("northwind-2");
      });
    });
  });

  describe("ensureMirrorRows", () => {
    it("puts back rows that are missing, and resolves after (AC-12)", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");

        session.claims = {
          clerkUserId,
          clerkOrgId,
          clerkOrgRole: "org:member",
        };

        await expect(resolveStaffContext(tx)).rejects.toSatisfy(
          (error: unknown) =>
            isTenantResolutionError(error) && error.kind === "no_mirror_row",
        );

        await ensureMirrorRows(
          { clerkOrgId, name: "Repaired Agency" },
          {
            clerkUserId,
            email: "repair@northwind.test",
            name: "Rex Pair",
            imageUrl: undefined,
          },
          "member",
          tx,
        );

        const ctx = await resolveStaffContext(tx);

        expect(ctx.kind).toBe("staff");
        expect(ctx.clerkOrgId).toBe(clerkOrgId);
        // From the session claim, not from `memberships.role`.
        expect(ctx.role).toBe("member");
      });
    });

    it("is idempotent: running it twice leaves one row in each table (AC-13)", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");
        const user = {
          clerkUserId,
          email: "twice@northwind.test",
          name: "Tee Wice",
          imageUrl: undefined,
        };

        const first = await ensureMirrorRows(
          { clerkOrgId, name: "Twice Agency" },
          user,
          "admin",
          tx,
        );

        const second = await ensureMirrorRows(
          { clerkOrgId, name: "Twice Agency" },
          user,
          "admin",
          tx,
        );

        expect(second).toEqual(first);

        const orgs = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.clerkOrgId, clerkOrgId));
        const userRows = await tx
          .select()
          .from(users)
          .where(eq(users.clerkUserId, clerkUserId));
        const membershipRows = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.orgId, first.orgId));

        expect(orgs).toHaveLength(1);
        expect(userRows).toHaveLength(1);
        expect(membershipRows).toHaveLength(1);
      });
    });

    it("does not rewrite the slug of a row that already has one (AC-10)", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const user = {
          clerkUserId: clerkId("user"),
          email: "keep@northwind.test",
          name: undefined,
          imageUrl: undefined,
        };

        // A first agency takes `northwind`, so a fresh derivation would now
        // resolve to `northwind-2`.
        await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Northwind" },
          {
            clerkUserId: clerkId("user"),
            email: "first@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        const ids = await ensureMirrorRows(
          { clerkOrgId, name: "Keepsake" },
          user,
          "admin",
          tx,
        );

        await ensureMirrorRows(
          { clerkOrgId, name: "Keepsake" },
          user,
          "admin",
          tx,
        );

        const [org] = await tx
          .select({ slug: organizations.slug })
          .from(organizations)
          .where(eq(organizations.id, ids.orgId));

        expect(org?.slug).toBe("keepsake");
      });
    });

    it("keeps Clerk authoritative for the columns it owns", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");

        const ids = await ensureMirrorRows(
          { clerkOrgId, name: "Before" },
          {
            clerkUserId,
            email: "before@northwind.test",
            name: "Before Name",
            imageUrl: undefined,
          },
          "member",
          tx,
        );

        await ensureMirrorRows(
          { clerkOrgId, name: "After" },
          {
            clerkUserId,
            email: "after@northwind.test",
            name: "After Name",
            imageUrl: "https://img.clerk.test/after",
          },
          "admin",
          tx,
        );

        const [org] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, ids.orgId));
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, ids.userId));
        const [membership] = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.orgId, ids.orgId));

        expect(org?.name).toBe("After");
        expect(user?.email).toBe("after@northwind.test");
        expect(user?.name).toBe("After Name");
        expect(user?.imageUrl).toBe("https://img.clerk.test/after");
        expect(membership?.role).toBe("admin");
      });
    });

    it("survives two overlapping repairs for the same person", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");
        const args = [
          { clerkOrgId, name: "Overlapping" },
          {
            clerkUserId,
            email: "overlap@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
        ] as const;

        const [first, second] = await Promise.all([
          ensureMirrorRows(args[0], args[1], "admin", tx),
          ensureMirrorRows(args[0], args[1], "admin", tx),
        ]);

        expect(second).toEqual(first);

        const orgs = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.clerkOrgId, clerkOrgId));

        expect(orgs).toHaveLength(1);
      });
    });
  });

  describe("a soft deleted organization (AC-14)", () => {
    it("resolves as absent rather than as a live tenant", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const clerkUserId = clerkId("user");

        session.claims = { clerkUserId, clerkOrgId, clerkOrgRole: "org:admin" };

        const ids = await createAgencyRows(
          { clerkOrgId, name: "Doomed Agency" },
          {
            clerkUserId,
            email: "doomed@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        // It resolves while it is alive.
        await expect(resolveStaffContext(tx)).resolves.toMatchObject({
          orgId: ids.orgId,
        });

        // What the Clerk `organization.deleted` webhook will do (feature 17).
        await tx
          .update(organizations)
          .set({ deletedAt: new Date() })
          .where(eq(organizations.id, ids.orgId));

        await expect(resolveStaffContext(tx)).rejects.toSatisfy(
          (error: unknown) =>
            isTenantResolutionError(error) && error.kind === "no_mirror_row",
        );

        // And the row is still there: this is a soft delete, not a removal.
        const rows = await tx
          .select()
          .from(organizations)
          .where(
            and(
              eq(organizations.id, ids.orgId),
              isNull(organizations.deletedAt),
            ),
          );

        expect(rows).toHaveLength(0);
      });
    });
  });

  describe("ensureUserRow's guard against a scrubbed row (spec 0015, AC-8)", () => {
    it("never revives or rewrites a row with deleted_at set", async () => {
      await inRollback(async (tx) => {
        const clerkUserId = clerkId("user");

        const [scrubbed] = await tx
          .insert(users)
          .values({
            id: newId(),
            clerkUserId,
            email: `deleted+seed@invalid`,
            name: "Deleted user",
            deletedAt: new Date(),
          })
          .returning({ id: users.id });

        await expect(
          ensureUserRow(
            {
              clerkUserId,
              email: "revived@northwind.test",
              name: "Revived Name",
              imageUrl: undefined,
            },
            tx,
          ),
        ).rejects.toBeInstanceOf(MirrorUserDeleted);

        const [row] = await tx
          .select()
          .from(users)
          .where(eq(users.id, scrubbed?.id ?? ""));

        expect(row?.email).toBe("deleted+seed@invalid");
        expect(row?.name).toBe("Deleted user");
      });
    });
  });

  describe("upsertOrganizationRow's guard against a soft deleted row (spec 0015, AC-10)", () => {
    it('returns "deleted" and writes nothing', async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");

        await tx.insert(organizations).values({
          id: newId(),
          clerkOrgId,
          name: "Was Deleted",
          slug: `was-deleted-${clerkOrgId}`,
          deletedAt: new Date(),
        });

        const result = await upsertOrganizationRow(
          { clerkOrgId, name: "Trying To Revive" },
          tx,
        );

        expect(result).toBe("deleted");

        const [row] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.clerkOrgId, clerkOrgId));

        expect(row?.name).toBe("Was Deleted");
      });
    });
  });

  describe("softDeleteOrganization (spec 0015, AC-6)", () => {
    it("sets deleted_at once and coalesces a second call rather than resetting the clock", async () => {
      await inRollback(async (tx) => {
        const clerkOrgId = clerkId("org");
        const [org] = await tx
          .insert(organizations)
          .values({
            id: newId(),
            clerkOrgId,
            name: "Doomed",
            slug: `doomed-${clerkOrgId}`,
          })
          .returning({ id: organizations.id });

        const first = await softDeleteOrganization(clerkOrgId, tx);
        expect(first).not.toBe("not_found");

        const [afterFirst] = await tx
          .select({ deletedAt: organizations.deletedAt })
          .from(organizations)
          .where(eq(organizations.id, org?.id ?? ""));

        const second = await softDeleteOrganization(clerkOrgId, tx);
        expect(second).not.toBe("not_found");

        const [afterSecond] = await tx
          .select({ deletedAt: organizations.deletedAt })
          .from(organizations)
          .where(eq(organizations.id, org?.id ?? ""));

        expect(afterSecond?.deletedAt).toEqual(afterFirst?.deletedAt);
      });
    });

    it("answers not_found for a clerk_org_id this mirror never held", async () => {
      await inRollback(async (tx) => {
        expect(await softDeleteOrganization(clerkId("org"), tx)).toBe(
          "not_found",
        );
      });
    });
  });

  describe("deleteMembershipRows (spec 0015, AC-6, AC-9, AC-11)", () => {
    it("deletes every row for an organization when given only orgId", async () => {
      await inRollback(async (tx) => {
        const org = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Org Scoped Delete" },
          {
            clerkUserId: clerkId("user"),
            email: "a@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        await deleteMembershipRows({ orgId: org.orgId }, tx);

        const rows = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.orgId, org.orgId));

        expect(rows).toHaveLength(0);
      });
    });

    it("deletes every row for a user when given only userId", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "User Scoped Delete" },
          {
            clerkUserId: clerkId("user"),
            email: "b@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        await deleteMembershipRows({ userId: ids.userId }, tx);

        const rows = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.userId, ids.userId));

        expect(rows).toHaveLength(0);
      });
    });

    it("deletes exactly one (org_id, user_id) pair when given both", async () => {
      await inRollback(async (tx) => {
        const orgA = clerkId("org");
        const clerkUserId = clerkId("user");

        const first = await createAgencyRows(
          { clerkOrgId: orgA, name: "Pair Delete A" },
          {
            clerkUserId,
            email: "c@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        const second = await ensureMirrorRows(
          { clerkOrgId: clerkId("org"), name: "Pair Delete B" },
          {
            clerkUserId,
            email: "c@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          "member",
          tx,
        );

        await deleteMembershipRows(
          { orgId: first.orgId, userId: first.userId },
          tx,
        );

        expect(
          await tx
            .select()
            .from(memberships)
            .where(eq(memberships.orgId, first.orgId)),
        ).toHaveLength(0);
        // The other agency's membership for the same person is untouched.
        expect(
          await tx
            .select()
            .from(memberships)
            .where(eq(memberships.orgId, second.orgId)),
        ).toHaveLength(1);
      });
    });
  });

  describe("unbindContactsOfUser (spec 0015, AC-9)", () => {
    it("clears user_id and accepted_at, leaving every other column", async () => {
      await inRollback(async (tx) => {
        const ids = await createAgencyRows(
          { clerkOrgId: clerkId("org"), name: "Contact Unbind Agency" },
          {
            clerkUserId: clerkId("user"),
            email: "staff@northwind.test",
            name: undefined,
            imageUrl: undefined,
          },
          tx,
        );

        const [client] = await tx
          .insert(clients)
          .values({ id: newId(), orgId: ids.orgId, name: "A Client" })
          .returning({ id: clients.id });

        const contactUserId = newId();
        await tx.insert(users).values({
          id: contactUserId,
          clerkUserId: clerkId("user"),
          email: "contact@example.test",
          name: "Contact Person",
        });

        const [contact] = await tx
          .insert(clientContacts)
          .values({
            id: newId(),
            orgId: ids.orgId,
            clientId: client?.id ?? "",
            userId: contactUserId,
            email: "contact@example.test",
            name: "Contact Person",
            acceptedAt: new Date(),
          })
          .returning({ id: clientContacts.id });

        await unbindContactsOfUser({ userId: contactUserId }, tx);

        const [row] = await tx
          .select()
          .from(clientContacts)
          .where(eq(clientContacts.id, contact?.id ?? ""));

        expect(row?.userId).toBeNull();
        expect(row?.acceptedAt).toBeNull();
        expect(row?.email).toBe("contact@example.test");
        expect(row?.name).toBe("Contact Person");
      });
    });
  });
});
