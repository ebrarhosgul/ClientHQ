/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-6
 *
 * The expired invite sweep against real PostgreSQL: a token past the 30 day
 * cutoff is cleared, one just inside it is left alone, and a currently valid
 * or already accepted invitation is untouched.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { clientContacts, clients, organizations } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import { expiredInvitesSweep } from "./expired-invites-sweep";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const NOW = new Date("2026-06-15T12:00:00Z");
const THIRTY_ONE_DAYS_AGO = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
const TWENTY_NINE_DAYS_AGO = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
const IN_A_WEEK = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

const createdOrgs: string[] = [];

/**
 * Drawn from `randomUUID()` rather than `newId()`'s time ordered bits: this
 * suite runs concurrently with every other `*.db.test.ts` file against one
 * shared database, and a millisecond timestamp prefix collides across files
 * under that load in a way a fully random one does not.
 */
function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

async function makeOrgAndClient(): Promise<{
  readonly orgId: string;
  readonly clientId: string;
}> {
  const orgId = newId();
  const clientId = newId();
  const unique = tag();

  await db.insert(organizations).values({
    id: orgId,
    clerkOrgId: `org_${unique}`,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
  });
  await db.insert(clients).values({ id: clientId, orgId, name: "A client" });

  createdOrgs.push(orgId);

  return { orgId, clientId };
}

async function makeContact(patch: {
  readonly orgId: string;
  readonly clientId: string;
  readonly inviteTokenHash: string | null;
  readonly inviteExpiresAt: Date | null;
  readonly acceptedAt?: Date;
}): Promise<string> {
  const id = newId();
  const unique = tag();

  await db.insert(clientContacts).values({
    id,
    orgId: patch.orgId,
    clientId: patch.clientId,
    email: `${unique}@example.test`,
    name: "A contact",
    inviteTokenHash: patch.inviteTokenHash,
    inviteExpiresAt: patch.inviteExpiresAt,
    acceptedAt: patch.acceptedAt,
  });

  return id;
}

async function inviteColumnsOf(id: string) {
  const [row] = await db
    .select({
      inviteTokenHash: clientContacts.inviteTokenHash,
      inviteExpiresAt: clientContacts.inviteExpiresAt,
    })
    .from(clientContacts)
    .where(eq(clientContacts.id, id));

  return row;
}

afterEach(async () => {
  if (createdOrgs.length === 0) {
    return;
  }

  await db
    .delete(clientContacts)
    .where(inArray(clientContacts.orgId, createdOrgs));
  await db.delete(clients).where(inArray(clients.orgId, createdOrgs));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgs));

  createdOrgs.length = 0;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("expired_invites against real PostgreSQL", () => {
  it("clears a token past the 30 day cutoff and leaves the rest alone", async () => {
    const { orgId, clientId } = await makeOrgAndClient();

    const expired = await makeContact({
      orgId,
      clientId,
      inviteTokenHash: "hash-expired",
      inviteExpiresAt: THIRTY_ONE_DAYS_AGO,
    });
    const justInside = await makeContact({
      orgId,
      clientId,
      inviteTokenHash: "hash-recent",
      inviteExpiresAt: TWENTY_NINE_DAYS_AGO,
    });
    const stillValid = await makeContact({
      orgId,
      clientId,
      inviteTokenHash: "hash-valid",
      inviteExpiresAt: IN_A_WEEK,
    });
    const accepted = await makeContact({
      orgId,
      clientId,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      acceptedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const report = await expiredInvitesSweep.run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report.outcome).toBe("ok");
    expect(report.counts).toEqual({ cleared: 1 });

    expect(await inviteColumnsOf(expired)).toEqual({
      inviteTokenHash: null,
      inviteExpiresAt: null,
    });
    expect(await inviteColumnsOf(justInside)).toEqual({
      inviteTokenHash: "hash-recent",
      inviteExpiresAt: TWENTY_NINE_DAYS_AGO,
    });
    expect(await inviteColumnsOf(stillValid)).toEqual({
      inviteTokenHash: "hash-valid",
      inviteExpiresAt: IN_A_WEEK,
    });
    expect(await inviteColumnsOf(accepted)).toEqual({
      inviteTokenHash: null,
      inviteExpiresAt: null,
    });
  });

  it("reports zero and changes nothing when no invite qualifies", async () => {
    const { orgId, clientId } = await makeOrgAndClient();
    await makeContact({
      orgId,
      clientId,
      inviteTokenHash: "hash-valid",
      inviteExpiresAt: IN_A_WEEK,
    });

    const report = await expiredInvitesSweep.run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report).toEqual({ outcome: "ok", counts: { cleared: 0 } });
  });
});
