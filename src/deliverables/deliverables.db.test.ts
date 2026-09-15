/**
 * @vitest-environment node
 *
 * covers: spec 0011 AC-1, AC-4, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12,
 * AC-13, AC-14, AC-15, AC-16, AC-17, AC-18
 *
 * The five Server Actions, `listDeliverables`, and the download route
 * against real PostgreSQL, with the session module stubbed to say who is
 * asking and the storage port replaced by the in memory fake. Every case
 * runs inside a transaction that is rolled back afterwards.
 *
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  deliverables,
  memberships,
  organizations,
  projects,
  subscriptions,
  users,
} from "@/db/schema";
import type { TransactionExecutor } from "@/db/tenant";
import {
  createFakeObjectStorage,
  type FakeObjectStorage,
} from "@/storage/fake";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

const state = vi.hoisted(() => ({
  tx: undefined as unknown,
  claims: {
    clerkUserId: undefined as string | undefined,
    clerkOrgId: undefined as string | undefined,
    clerkOrgRole: undefined as string | undefined,
  },
  cookie: undefined as string | undefined,
  storageConfigured: true,
  storage: undefined as FakeObjectStorage | undefined,
}));

vi.mock("@/db/tenant/executor", () => ({ pooledDb: async () => state.tx }));

vi.mock("@/db/tenant/session", () => ({
  CONTACT_COOKIE_NAME: "clienthq_contact",
  CLERK_ADMIN_ROLE: "org:admin",
  sessionClaims: async () => state.claims,
  contactCookie: async () => state.cookie,
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
  updateTag: () => undefined,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${to}`,
    });
  },
}));

vi.mock("@/storage", () => ({
  objectStorage: () => (state.storageConfigured ? state.storage : undefined),
  isStorageConfigured: () => state.storageConfigured,
}));

const { requestUpload } = await import("./request-upload");
const { confirmUpload } = await import("./confirm-upload");
const { abandonUpload } = await import("./abandon-upload");
const { setDeliverableVisibility } =
  await import("./set-deliverable-visibility");
const { deleteDeliverable } = await import("./delete-deliverable");
const { listDeliverables } = await import("./queries");
const { GET } = await import("@/app/deliverables/[id]/download/route");

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

type Fixture = {
  readonly orgA: string;
  readonly clerkOrgA: string;
  readonly staffA: string;
  readonly clerkStaffA: string;
  readonly staffA2: string;
  readonly clerkStaffA2: string;
  readonly orgB: string;
  readonly clerkOrgB: string;
  readonly staffB: string;
  readonly clerkStaffB: string;
  readonly clientA1: string;
  readonly clientA2: string;
  readonly projectA1: string;
  readonly projectA1Archived: string;
  readonly contactA1: string;
  readonly clerkContactA1: string;
  readonly contactA2: string;
  readonly clerkContactA2: string;
  readonly tag: string;
};

async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId();
  const ids = {
    orgA: newId(),
    orgB: newId(),
    staffA: newId(),
    staffA2: newId(),
    staffB: newId(),
    contactUserA1: newId(),
    contactUserA2: newId(),
    clientA1: newId(),
    clientA2: newId(),
    projectA1: newId(),
    projectA1Archived: newId(),
    contactA1: newId(),
    contactA2: newId(),
  };

  await tx.insert(organizations).values([
    {
      id: ids.orgA,
      clerkOrgId: `org_${tag}_a`,
      name: "Agency A",
      slug: `a-${tag}`,
    },
    {
      id: ids.orgB,
      clerkOrgId: `org_${tag}_b`,
      name: "Agency B",
      slug: `b-${tag}`,
    },
  ]);

  await tx.insert(users).values([
    {
      id: ids.staffA,
      clerkUserId: `user_${tag}_a`,
      email: `staff-a-${tag}@example.test`,
      name: "Staff A",
    },
    {
      id: ids.staffA2,
      clerkUserId: `user_${tag}_a2`,
      email: `staff-a2-${tag}@example.test`,
      name: "Staff A2",
    },
    {
      id: ids.staffB,
      clerkUserId: `user_${tag}_b`,
      email: `staff-b-${tag}@example.test`,
      name: "Staff B",
    },
    {
      id: ids.contactUserA1,
      clerkUserId: `user_${tag}_c1`,
      email: `contact-1-${tag}@example.test`,
      name: "Contact One",
    },
    {
      id: ids.contactUserA2,
      clerkUserId: `user_${tag}_c2`,
      email: `contact-2-${tag}@example.test`,
      name: "Contact Two",
    },
  ]);

  await tx.insert(memberships).values([
    { id: newId(), orgId: ids.orgA, userId: ids.staffA, role: "admin" },
    { id: newId(), orgId: ids.orgA, userId: ids.staffA2, role: "member" },
    { id: newId(), orgId: ids.orgB, userId: ids.staffB, role: "admin" },
  ]);

  await tx.insert(subscriptions).values([
    {
      id: newId(),
      orgId: ids.orgA,
      stripeCustomerId: `cus_${tag}_a`,
      status: "active",
    },
    {
      id: newId(),
      orgId: ids.orgB,
      stripeCustomerId: `cus_${tag}_b`,
      status: "active",
    },
  ]);

  await tx.insert(clients).values([
    { id: ids.clientA1, orgId: ids.orgA, name: "Northwind" },
    { id: ids.clientA2, orgId: ids.orgA, name: "Ridgeline" },
  ]);

  await tx.insert(projects).values([
    {
      id: ids.projectA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      name: "Website",
    },
    {
      id: ids.projectA1Archived,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      name: "Old brand",
      archivedAt: new Date(),
    },
  ]);

  await tx.insert(clientContacts).values([
    {
      id: ids.contactA1,
      orgId: ids.orgA,
      clientId: ids.clientA1,
      userId: ids.contactUserA1,
      email: `contact-1-${tag}@example.test`,
      name: "Contact One",
      acceptedAt: new Date(),
    },
    {
      id: ids.contactA2,
      orgId: ids.orgA,
      clientId: ids.clientA2,
      userId: ids.contactUserA2,
      email: `contact-2-${tag}@example.test`,
      name: "Contact Two",
      acceptedAt: new Date(),
    },
  ]);

  return {
    orgA: ids.orgA,
    clerkOrgA: `org_${tag}_a`,
    staffA: ids.staffA,
    clerkStaffA: `user_${tag}_a`,
    staffA2: ids.staffA2,
    clerkStaffA2: `user_${tag}_a2`,
    orgB: ids.orgB,
    clerkOrgB: `org_${tag}_b`,
    staffB: ids.staffB,
    clerkStaffB: `user_${tag}_b`,
    clientA1: ids.clientA1,
    clientA2: ids.clientA2,
    projectA1: ids.projectA1,
    projectA1Archived: ids.projectA1Archived,
    contactA1: ids.contactA1,
    clerkContactA1: `user_${tag}_c1`,
    contactA2: ids.contactA2,
    clerkContactA2: `user_${tag}_c2`,
    tag,
  };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      state.tx = tx;
      const fixture = await seed(tx);
      actAsStaff(fixture, "A");
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

function actAsStaff(fixture: Fixture, org: "A" | "A2" | "B"): void {
  state.claims = {
    clerkUserId:
      org === "A"
        ? fixture.clerkStaffA
        : org === "A2"
          ? fixture.clerkStaffA2
          : fixture.clerkStaffB,
    clerkOrgId: org === "B" ? fixture.clerkOrgB : fixture.clerkOrgA,
    clerkOrgRole: "org:admin",
  };
}

function actAsContact(fixture: Fixture, contact: "1" | "2"): void {
  state.claims = {
    clerkUserId:
      contact === "1" ? fixture.clerkContactA1 : fixture.clerkContactA2,
    clerkOrgId: undefined,
    clerkOrgRole: undefined,
  };
}

async function insertPending(
  tx: TransactionExecutor,
  fixture: Fixture,
  overrides: Partial<typeof deliverables.$inferInsert> = {},
) {
  const id = newId();
  const [row] = await tx
    .insert(deliverables)
    .values({
      id,
      orgId: fixture.orgA,
      projectId: fixture.projectA1,
      name: "Style guide.pdf",
      r2Key: `org/${fixture.orgA}/project/${fixture.projectA1}/${id}`,
      contentType: "application/pdf",
      sizeBytes: 1024,
      uploadedByUserId: fixture.staffA,
      status: "pending",
      ...overrides,
    })
    .returning();

  return row;
}

beforeEach(() => {
  state.storageConfigured = true;
  state.storage = createFakeObjectStorage();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(url === undefined)(
  "deliverables against real PostgreSQL",
  () => {
    describe("requestUpload (AC-1, AC-4)", () => {
      it("inserts a pending row with the real object key and returns a signed URL", async () => {
        await inRollback(async (_tx, fixture) => {
          const result = await requestUpload({
            projectId: fixture.projectA1,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(result.data.uploadUrl).toContain(result.data.deliverableId);

          const [row] = await (state.tx as TransactionExecutor)
            .select()
            .from(deliverables)
            .where(eq(deliverables.id, result.data.deliverableId));

          expect(row?.r2Key).toBe(
            `org/${fixture.orgA}/project/${fixture.projectA1}/${result.data.deliverableId}`,
          );
          expect(row?.status).toBe("pending");
        });
      });

      it("refuses an archived project with conflict", async () => {
        await inRollback(async (_tx, fixture) => {
          const result = await requestUpload({
            projectId: fixture.projectA1Archived,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });
        });
      });

      it("resolves another agency's project as not_found", async () => {
        await inRollback(async (_tx, fixture) => {
          const result = await requestUpload({
            projectId: fixture.projectA1,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });
          expect(result.ok).toBe(true);

          actAsStaff(fixture, "B");

          const crossTenant = await requestUpload({
            projectId: fixture.projectA1,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });

          expect(crossTenant).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });

      it("refuses with conflict before touching a row when storage is not configured", async () => {
        await inRollback(async (_tx, fixture) => {
          state.storageConfigured = false;

          const result = await requestUpload({
            projectId: fixture.projectA1,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });

          expect(result).toMatchObject({
            ok: false,
            error: {
              code: "conflict",
              message: "File storage is not configured for this environment",
            },
          });
        });
      });

      it("refuses a client contact with forbidden", async () => {
        await inRollback(async (_tx, fixture) => {
          actAsContact(fixture, "1");

          const result = await requestUpload({
            projectId: fixture.projectA1,
            name: "Logo.png",
            contentType: "image/png",
            sizeBytes: 2048,
          });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "forbidden" },
          });
        });
      });
    });

    describe("confirmUpload (AC-6, AC-7)", () => {
      it("flips a pending row to ready once the object lands", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 4096,
          });

          const result = await confirmUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: true,
            data: {
              status: "ready",
              sizeBytes: 4096,
              contentType: "application/pdf",
            },
          });
        });
      });

      it("returns conflict and leaves the row pending when the object has not landed yet, retry succeeds after it does", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          const first = await confirmUpload({ deliverableId: row.id });
          expect(first).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });

          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 4096,
          });

          const second = await confirmUpload({ deliverableId: row.id });
          expect(second.ok).toBe(true);
        });
      });

      it("deletes the object and the row, returning validation, when the object is outside the rules", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);
          state.storage?.put(row.r2Key, {
            contentType: "application/x-msdownload",
            contentLength: 10,
          });

          const result = await confirmUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "validation" },
          });
          expect(state.storage?.has(row.r2Key)).toBe(false);

          const remaining = await tx
            .select()
            .from(deliverables)
            .where(eq(deliverables.id, row.id));

          expect(remaining).toHaveLength(0);
        });
      });

      it("short circuits on an already ready row for any staff member, no R2 call", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, {
            status: "ready",
            sizeBytes: 555,
            contentType: "text/csv",
          });

          actAsStaff(fixture, "A2");

          const result = await confirmUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: true,
            data: { status: "ready", sizeBytes: 555, contentType: "text/csv" },
          });
        });
      });

      it("refuses a second staff member confirming the first member's still pending row", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          actAsStaff(fixture, "A2");

          const result = await confirmUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });

      it("resolves another agency's row as not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          actAsStaff(fixture, "B");

          const result = await confirmUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });
    });

    describe("abandonUpload (AC-7, AC-8)", () => {
      it("deletes the object if one landed, then the row", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 10,
          });

          const result = await abandonUpload({ deliverableId: row.id });

          expect(result).toMatchObject({ ok: true, data: { removed: true } });
          expect(state.storage?.has(row.r2Key)).toBe(false);
        });
      });

      it("succeeds with removed: false for a row that is already gone", async () => {
        await inRollback(async () => {
          const result = await abandonUpload({ deliverableId: newId() });

          expect(result).toMatchObject({ ok: true, data: { removed: false } });
        });
      });

      it("refuses another user's pending row with not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          actAsStaff(fixture, "A2");

          const result = await abandonUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });

      it("refuses a ready row (not pending any more) with not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });

          const result = await abandonUpload({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });
    });

    describe("setDeliverableVisibility (AC-9, AC-11)", () => {
      it("flips the switch and is idempotent when set to the value it already has", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });

          const first = await setDeliverableVisibility({
            deliverableId: row.id,
            visibleToClient: true,
          });
          expect(first).toMatchObject({
            ok: true,
            data: { visibleToClient: true },
          });

          const second = await setDeliverableVisibility({
            deliverableId: row.id,
            visibleToClient: true,
          });
          expect(second).toMatchObject({
            ok: true,
            data: { visibleToClient: true },
          });
        });
      });

      it("refuses a pending row with not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          const result = await setDeliverableVisibility({
            deliverableId: row.id,
            visibleToClient: true,
          });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });

      it("resolves another agency's row as not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });

          actAsStaff(fixture, "B");

          const result = await setDeliverableVisibility({
            deliverableId: row.id,
            visibleToClient: true,
          });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });
    });

    describe("deleteDeliverable (AC-15)", () => {
      it("deletes the object first, then the row", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 10,
          });

          const result = await deleteDeliverable({ deliverableId: row.id });

          expect(result).toMatchObject({ ok: true, data: { removed: true } });
          expect(state.storage?.deleted).toContain(row.r2Key);
        });
      });

      it("leaves the row in place and returns conflict when the store fails to delete", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 10,
          });
          state.storage?.failNextDelete();

          const result = await deleteDeliverable({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "conflict" },
          });

          const [stillThere] = await tx
            .select()
            .from(deliverables)
            .where(eq(deliverables.id, row.id));

          expect(stillThere).toBeDefined();
        });
      });

      it("succeeds with removed: false for a row that is already gone", async () => {
        await inRollback(async () => {
          const result = await deleteDeliverable({ deliverableId: newId() });

          expect(result).toMatchObject({ ok: true, data: { removed: false } });
        });
      });

      it("refuses a pending row with not_found", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          const result = await deleteDeliverable({ deliverableId: row.id });

          expect(result).toMatchObject({
            ok: false,
            error: { code: "not_found" },
          });
        });
      });
    });

    describe("listDeliverables (AC-9, AC-10)", () => {
      it("returns only ready rows, newest first, with the uploader's name", async () => {
        await inRollback(async (tx, fixture) => {
          await insertPending(tx, fixture, {
            name: "Old.pdf",
            status: "ready",
            createdAt: new Date("2026-01-01"),
          });
          await insertPending(tx, fixture, {
            name: "New.pdf",
            status: "ready",
            createdAt: new Date("2026-02-01"),
          });
          await insertPending(tx, fixture, {
            name: "Pending.pdf",
            status: "pending",
          });

          const rows = await listDeliverables(
            {
              kind: "staff",
              orgId: fixture.orgA,
              clerkOrgId: fixture.clerkOrgA,
              userId: fixture.staffA,
              clerkUserId: fixture.clerkStaffA,
              role: "admin",
            },
            fixture.projectA1,
          );

          expect(rows.map((r) => r.name)).toEqual(["New.pdf", "Old.pdf"]);
          expect(rows.every((r) => r.uploadedByName === "Staff A")).toBe(true);
        });
      });
    });

    describe("GET /deliverables/[id]/download (AC-12, AC-13, AC-14, AC-18)", () => {
      it("answers 503 with a readable page when storage is not configured", async () => {
        state.storageConfigured = false;

        const response = await GET(new Request("http://localhost/x"), {
          params: Promise.resolve({ id: newId() }),
        });

        expect(response.status).toBe(503);
        const body = await response.text();
        expect(body).toContain("File storage is not configured");
      });

      it("redirects staff to a signed URL for a ready row of their own agency", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 10,
          });

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(302);
          expect(response.headers.get("location")).toContain(
            encodeURIComponent(row.r2Key),
          );
        });
      });

      it("answers the app's 404 for a pending row", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture);

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("Page not found");
        });
      });

      it("answers the app's 404 for another agency's staff", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });

          actAsStaff(fixture, "B");

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("Page not found");
        });
      });

      it("answers a readable missing file page with 404 when the object behind a ready row is gone", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, { status: "ready" });

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("This file is missing");
        });
      });

      it("redirects a contact to a signed URL for a ready, visible deliverable of their own client", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, {
            status: "ready",
            visibleToClient: true,
          });
          state.storage?.put(row.r2Key, {
            contentType: "application/pdf",
            contentLength: 10,
          });

          actAsContact(fixture, "1");

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(302);
        });
      });

      it("answers 404 for a contact of a different client", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, {
            status: "ready",
            visibleToClient: true,
          });

          actAsContact(fixture, "2");

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("Page not found");
        });
      });

      it("answers 404 for a contact when visible_to_client is false", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, {
            status: "ready",
            visibleToClient: false,
          });

          actAsContact(fixture, "1");

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("Page not found");
        });
      });

      it("answers 404 for a contact when the project is archived", async () => {
        await inRollback(async (tx, fixture) => {
          const row = await insertPending(tx, fixture, {
            status: "ready",
            visibleToClient: true,
            projectId: fixture.projectA1Archived,
          });

          actAsContact(fixture, "1");

          const response = await GET(new Request("http://localhost/x"), {
            params: Promise.resolve({ id: row.id }),
          });

          expect(response.status).toBe(404);
          const body = await response.text();
          expect(body).toContain("Page not found");
        });
      });
    });
  },
);
