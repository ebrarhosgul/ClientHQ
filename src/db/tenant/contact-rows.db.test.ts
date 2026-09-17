/**
 * @vitest-environment node
 *
 * covers: spec 0014 AC-11
 *
 * `listAcceptedContactRows` against real PostgreSQL: the one cross
 * organization read the switcher needs. Same shape as
 * `organization.db.test.ts`: everything runs inside a transaction that is
 * rolled back, skipped when `DIRECT_URL` is unset.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import * as schema from "../schema";
import { clientContacts, clients, organizations, users } from "../schema";
import { listAcceptedContactRows } from "./contact-rows";
import type { TransactionExecutor } from "./executor";

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

// `newId()`'s own first 8 characters are a millisecond timestamp, coarse
// enough (65 second granularity) that two calls within the same test run,
// or two parallel test files, can collide on it; `Math.random()`, as
// `organization.db.test.ts`'s own `clerkId` helper uses, does not.
const tag = () => Math.random().toString(36).slice(2, 10);

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

describe.skipIf(!url)("listAcceptedContactRows against real PostgreSQL", () => {
  it("lists every accepted row across two agencies, ordered by client name (AC-11)", async () => {
    await inRollback(async (tx) => {
      const suffix = tag();
      const orgA = newId();
      const orgB = newId();
      const user = newId();
      const clientA = newId();
      const clientB = newId();
      const rowA = newId();
      const rowB = newId();

      await tx.insert(organizations).values([
        {
          id: orgA,
          clerkOrgId: `org_${suffix}_a`,
          name: "Agency A",
          slug: `agency-a-${suffix}`,
        },
        {
          id: orgB,
          clerkOrgId: `org_${suffix}_b`,
          name: "Agency B",
          slug: `agency-b-${suffix}`,
        },
      ]);

      await tx.insert(users).values({
        id: user,
        clerkUserId: `user_${suffix}`,
        email: `switcher-${suffix}@example.com`,
      });

      await tx.insert(clients).values([
        { id: clientA, orgId: orgA, name: "Zeta Studio" },
        { id: clientB, orgId: orgB, name: "Anchor Works" },
      ]);

      await tx.insert(clientContacts).values([
        {
          id: rowA,
          orgId: orgA,
          clientId: clientA,
          userId: user,
          email: `contact-a-${suffix}@example.com`,
          name: "Contact A",
          acceptedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: rowB,
          orgId: orgB,
          clientId: clientB,
          userId: user,
          email: `contact-b-${suffix}@example.com`,
          name: "Contact B",
          acceptedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ]);

      await expect(listAcceptedContactRows(user, tx)).resolves.toEqual([
        {
          contactId: rowB,
          clientId: clientB,
          orgId: orgB,
          clientName: "Anchor Works",
          agencyName: "Agency B",
        },
        {
          contactId: rowA,
          clientId: clientA,
          orgId: orgA,
          clientName: "Zeta Studio",
          agencyName: "Agency A",
        },
      ]);
    });
  });

  it("never lists another user's row", async () => {
    await inRollback(async (tx) => {
      const suffix = tag();
      const org = newId();
      const owner = newId();
      const other = newId();
      const client = newId();

      await tx.insert(organizations).values({
        id: org,
        clerkOrgId: `org_${suffix}`,
        name: "Agency",
        slug: `agency-${suffix}`,
      });

      await tx.insert(users).values([
        {
          id: owner,
          clerkUserId: `user_${suffix}_owner`,
          email: `owner-${suffix}@example.com`,
        },
        {
          id: other,
          clerkUserId: `user_${suffix}_other`,
          email: `other-${suffix}@example.com`,
        },
      ]);

      await tx
        .insert(clients)
        .values({ id: client, orgId: org, name: "Client" });

      await tx.insert(clientContacts).values({
        id: newId(),
        orgId: org,
        clientId: client,
        userId: other,
        email: `other-contact-${suffix}@example.com`,
        name: "Other's contact",
        acceptedAt: new Date(),
      });

      await expect(listAcceptedContactRows(owner, tx)).resolves.toEqual([]);
    });
  });

  it("excludes a row this same user has not yet accepted", async () => {
    await inRollback(async (tx) => {
      const suffix = tag();
      const org = newId();
      const user = newId();
      const acceptedClient = newId();
      const invitedClient = newId();

      await tx.insert(organizations).values({
        id: org,
        clerkOrgId: `org_${suffix}`,
        name: "Agency",
        slug: `agency-${suffix}`,
      });

      await tx.insert(users).values({
        id: user,
        clerkUserId: `user_${suffix}`,
        email: `contact-${suffix}@example.com`,
      });

      await tx.insert(clients).values([
        { id: acceptedClient, orgId: org, name: "Accepted client" },
        { id: invitedClient, orgId: org, name: "Invited client" },
      ]);

      const acceptedRow = newId();

      await tx.insert(clientContacts).values([
        {
          id: acceptedRow,
          orgId: org,
          clientId: acceptedClient,
          userId: user,
          email: `accepted-${suffix}@example.com`,
          name: "Accepted contact",
          acceptedAt: new Date(),
        },
        {
          id: newId(),
          orgId: org,
          clientId: invitedClient,
          userId: null,
          email: `invited-${suffix}@example.com`,
          name: "Invited contact",
          inviteTokenHash: "hash",
          inviteExpiresAt: new Date(Date.now() + 60_000),
        },
      ]);

      await expect(listAcceptedContactRows(user, tx)).resolves.toEqual([
        {
          contactId: acceptedRow,
          clientId: acceptedClient,
          orgId: org,
          clientName: "Accepted client",
          agencyName: "Agency",
        },
      ]);
    });
  });
});
