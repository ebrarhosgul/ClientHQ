/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-5
 *
 * The abandoned upload sweep against real PostgreSQL, with the storage port
 * replaced by the in memory fake: the 24 hour cutoff, oldest first ordering,
 * object first then row, the failed row left in place, the 200 row cap with
 * `truncated`, and the skip when no storage is bound.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  clients,
  deliverables,
  organizations,
  projects,
  users,
  type DeliverableStatus,
} from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";
import { createFakeObjectStorage } from "@/storage/fake";

import { abandonedUploadsSweep } from "./abandoned-sweep";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 5 });
const db: Database = drizzle(sql, { schema });

const NOW = new Date("2026-06-15T12:00:00Z");
const OLD = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);
const RECENT = new Date(NOW.getTime() - 23 * 60 * 60 * 1000);

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

async function makeOrg(): Promise<string> {
  const id = newId();
  const unique = tag();

  await db.insert(organizations).values({
    id,
    clerkOrgId: `org_${unique}`,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
  });

  createdOrgs.push(id);

  return id;
}

async function makeUser(): Promise<string> {
  const id = newId();
  const unique = tag();

  await db.insert(users).values({
    id,
    clerkUserId: `user_${unique}`,
    email: `${unique}@example.com`,
  });

  return id;
}

async function makeClient(orgId: string): Promise<string> {
  const id = newId();

  await db.insert(clients).values({ id, orgId, name: "A client" });

  return id;
}

async function makeProject(orgId: string, clientId: string): Promise<string> {
  const id = newId();

  await db.insert(projects).values({ id, orgId, clientId, name: "A project" });

  return id;
}

async function makeDeliverable(patch: {
  readonly orgId: string;
  readonly projectId: string;
  readonly uploadedByUserId: string;
  readonly status: DeliverableStatus;
  readonly createdAt: Date;
}): Promise<{ readonly id: string; readonly r2Key: string }> {
  const id = newId();
  const r2Key = `deliverables/${id}`;

  await db.insert(deliverables).values({
    id,
    orgId: patch.orgId,
    projectId: patch.projectId,
    name: "a-file.pdf",
    r2Key,
    contentType: "application/pdf",
    sizeBytes: 100,
    uploadedByUserId: patch.uploadedByUserId,
    status: patch.status,
    createdAt: patch.createdAt,
  });

  return { id, r2Key };
}

/**
 * One bulk `insert` rather than N round trips: fast enough that a 201 row
 * fixture does not risk this suite's timeout under the load of every other
 * `*.db.test.ts` file running at once.
 */
async function makeManyDeliverables(
  count: number,
  patch: {
    readonly orgId: string;
    readonly projectId: string;
    readonly uploadedByUserId: string;
  },
): Promise<readonly { readonly id: string; readonly r2Key: string }[]> {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = newId();
    return {
      id,
      r2Key: `deliverables/${id}`,
      orgId: patch.orgId,
      projectId: patch.projectId,
      name: "a-file.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      uploadedByUserId: patch.uploadedByUserId,
      status: "pending" as const,
      createdAt: new Date(OLD.getTime() - (count - index) * 1000),
    };
  });

  await db.insert(deliverables).values(rows);

  return rows.map(({ id, r2Key }) => ({ id, r2Key }));
}

async function statusOf(id: string): Promise<DeliverableStatus | undefined> {
  const [row] = await db
    .select({ status: deliverables.status })
    .from(deliverables)
    .where(eq(deliverables.id, id));

  return row?.status;
}

afterEach(async () => {
  if (createdOrgs.length === 0) {
    return;
  }

  await db.delete(deliverables).where(inArray(deliverables.orgId, createdOrgs));
  await db.delete(projects).where(inArray(projects.orgId, createdOrgs));
  await db.delete(clients).where(inArray(clients.orgId, createdOrgs));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgs));

  createdOrgs.length = 0;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("abandoned_uploads against real PostgreSQL", () => {
  it("removes a pending row past the cutoff, object first, and leaves a recent pending and a ready row alone", async () => {
    const orgId = await makeOrg();
    const userId = await makeUser();
    const clientId = await makeClient(orgId);
    const projectId = await makeProject(orgId, clientId);
    const storage = createFakeObjectStorage();

    const stale = await makeDeliverable({
      orgId,
      projectId,
      uploadedByUserId: userId,
      status: "pending",
      createdAt: OLD,
    });
    storage.put(stale.r2Key, {
      contentType: "application/pdf",
      contentLength: 1,
    });

    const recent = await makeDeliverable({
      orgId,
      projectId,
      uploadedByUserId: userId,
      status: "pending",
      createdAt: RECENT,
    });
    storage.put(recent.r2Key, {
      contentType: "application/pdf",
      contentLength: 1,
    });

    const ready = await makeDeliverable({
      orgId,
      projectId,
      uploadedByUserId: userId,
      status: "ready",
      createdAt: OLD,
    });
    storage.put(ready.r2Key, {
      contentType: "application/pdf",
      contentLength: 1,
    });

    const report = await abandonedUploadsSweep(storage).run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report.outcome).toBe("ok");
    expect(report.counts).toEqual({ removed: 1, failed: 0, truncated: false });
    expect(storage.deleted).toEqual([stale.r2Key]);
    expect(storage.has(stale.r2Key)).toBe(false);
    expect(await statusOf(stale.id)).toBeUndefined();
    expect(await statusOf(recent.id)).toBe("pending");
    expect(await statusOf(ready.id)).toBe("ready");
  });

  it("leaves the row in place when its object delete fails, and still removes the next one", async () => {
    const orgId = await makeOrg();
    const userId = await makeUser();
    const clientId = await makeClient(orgId);
    const projectId = await makeProject(orgId, clientId);
    const storage = createFakeObjectStorage();

    const first = await makeDeliverable({
      orgId,
      projectId,
      uploadedByUserId: userId,
      status: "pending",
      createdAt: new Date(OLD.getTime() - 1000),
    });
    const second = await makeDeliverable({
      orgId,
      projectId,
      uploadedByUserId: userId,
      status: "pending",
      createdAt: OLD,
    });
    storage.put(first.r2Key, {
      contentType: "application/pdf",
      contentLength: 1,
    });
    storage.put(second.r2Key, {
      contentType: "application/pdf",
      contentLength: 1,
    });

    // Oldest first means `first` is the next delete() call.
    storage.failNextDelete();

    const report = await abandonedUploadsSweep(storage).run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report.outcome).toBe("failed");
    expect(report.counts).toEqual({ removed: 1, failed: 1, truncated: false });
    expect(await statusOf(first.id)).toBe("pending");
    expect(storage.has(first.r2Key)).toBe(true);
    expect(await statusOf(second.id)).toBeUndefined();
  });

  it("removes at most 200 rows and reports truncated when a 201st qualifies", async () => {
    const orgId = await makeOrg();
    const userId = await makeUser();
    const clientId = await makeClient(orgId);
    const projectId = await makeProject(orgId, clientId);
    const storage = createFakeObjectStorage();

    const rows = await makeManyDeliverables(201, {
      orgId,
      projectId,
      uploadedByUserId: userId,
    });
    rows.forEach((row) =>
      storage.put(row.r2Key, {
        contentType: "application/pdf",
        contentLength: 1,
      }),
    );

    const report = await abandonedUploadsSweep(storage).run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report.outcome).toBe("ok");
    expect(report.counts).toEqual({ removed: 200, failed: 0, truncated: true });
  }, 60_000);

  it("skips and reports the reason when no storage is bound", async () => {
    const report = await abandonedUploadsSweep(undefined).run({
      db,
      todayUtc: "2026-06-15",
      now: NOW,
    });

    expect(report).toEqual({
      outcome: "skipped",
      reason: "storage not configured",
    });
  });
});
