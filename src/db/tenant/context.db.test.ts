/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-7
 *
 * `resolveContactContext` against real SQL: a contact whose agency has been
 * soft deleted has to resolve as `no_contact`, the same outcome as owning no
 * contact row at all, rather than as `no_mirror_row` (which would send them
 * down the wrong branch) or as a live tenant (which would let a deleted
 * agency keep serving its portal).
 *
 * Runs inside a transaction that is rolled back, the same shape as
 * `provisioning.db.test.ts`. Skipped when `DIRECT_URL` is not set.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import { loadEnvFiles } from "@/lib/load-env-files";
import { newId } from "@/lib/id";

import * as schema from "../schema";
import { clientContacts, clients, organizations, users } from "../schema";
import { resolveContactContext } from "./context";
import { isTenantResolutionError } from "./errors";
import type { TransactionExecutor } from "./executor";

const session = vi.hoisted(() => ({
  claims: {
    clerkUserId: undefined as string | undefined,
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

describe.skipIf(!url)("resolveContactContext against real PostgreSQL", () => {
  it("resolves a live agency's accepted contact normally", async () => {
    await inRollback(async (tx) => {
      const clerkUserId = clerkId("user");
      session.claims = { clerkUserId };

      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Live Agency",
          slug: `live-agency-${clerkUserId}`,
        })
        .returning({ id: organizations.id });

      await tx.insert(users).values({
        id: newId(),
        clerkUserId,
        email: "contact@example.test",
        name: "Live Contact",
      });

      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      const [client] = await tx
        .insert(clients)
        .values({ id: newId(), orgId: org?.id ?? "", name: "A Client" })
        .returning({ id: clients.id });

      await tx.insert(clientContacts).values({
        id: newId(),
        orgId: org?.id ?? "",
        clientId: client?.id ?? "",
        userId: user?.id ?? "",
        email: "contact@example.test",
        name: "Live Contact",
        acceptedAt: new Date(),
      });

      const ctx = await resolveContactContext(tx);

      expect(ctx.kind).toBe("contact");
      expect(ctx.orgId).toBe(org?.id);
    });
  });

  it("treats a contact of a soft deleted agency as no_contact (AC-7)", async () => {
    await inRollback(async (tx) => {
      const clerkUserId = clerkId("user");
      session.claims = { clerkUserId };

      const [org] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Deleted Agency",
          slug: `deleted-agency-${clerkUserId}`,
          deletedAt: new Date(),
        })
        .returning({ id: organizations.id });

      await tx.insert(users).values({
        id: newId(),
        clerkUserId,
        email: "orphaned@example.test",
        name: "Orphaned Contact",
      });

      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      const [client] = await tx
        .insert(clients)
        .values({ id: newId(), orgId: org?.id ?? "", name: "A Deleted Client" })
        .returning({ id: clients.id });

      await tx.insert(clientContacts).values({
        id: newId(),
        orgId: org?.id ?? "",
        clientId: client?.id ?? "",
        userId: user?.id ?? "",
        email: "orphaned@example.test",
        name: "Orphaned Contact",
        acceptedAt: new Date(),
      });

      // Not `no_mirror_row`: the person has a mirror row, just no *live*
      // contact. That distinction is what routes them correctly.
      await expect(resolveContactContext(tx)).rejects.toSatisfy(
        (error: unknown) =>
          isTenantResolutionError(error) && error.kind === "no_contact",
      );
    });
  });

  it("prefers a live agency's contact over a deleted agency's, whichever accepted more recently", async () => {
    await inRollback(async (tx) => {
      const clerkUserId = clerkId("user");
      session.claims = { clerkUserId };

      await tx.insert(users).values({
        id: newId(),
        clerkUserId,
        email: "multi@example.test",
        name: "Multi Agency Contact",
      });

      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      const [deletedOrg] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Deleted Agency",
          slug: `deleted-${clerkUserId}`,
          deletedAt: new Date(),
        })
        .returning({ id: organizations.id });

      const [liveOrg] = await tx
        .insert(organizations)
        .values({
          id: newId(),
          clerkOrgId: clerkId("org"),
          name: "Live Agency",
          slug: `live-${clerkUserId}`,
        })
        .returning({ id: organizations.id });

      const [deletedClient] = await tx
        .insert(clients)
        .values({
          id: newId(),
          orgId: deletedOrg?.id ?? "",
          name: "Old Client",
        })
        .returning({ id: clients.id });

      const [liveClient] = await tx
        .insert(clients)
        .values({ id: newId(), orgId: liveOrg?.id ?? "", name: "New Client" })
        .returning({ id: clients.id });

      // The deleted agency's contact accepted *more recently*, so a resolver
      // that only ordered by acceptance would pick it. It must not.
      await tx.insert(clientContacts).values({
        id: newId(),
        orgId: deletedOrg?.id ?? "",
        clientId: deletedClient?.id ?? "",
        userId: user?.id ?? "",
        email: "multi@example.test",
        name: "Multi Agency Contact",
        acceptedAt: new Date(),
      });

      await tx.insert(clientContacts).values({
        id: newId(),
        orgId: liveOrg?.id ?? "",
        clientId: liveClient?.id ?? "",
        userId: user?.id ?? "",
        email: "multi@example.test",
        name: "Multi Agency Contact",
        acceptedAt: new Date(Date.now() - 60_000),
      });

      const ctx = await resolveContactContext(tx);

      expect(ctx.orgId).toBe(liveOrg?.id);
    });
  });
});
