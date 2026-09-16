/**
 * @vitest-environment node
 *
 * covers: spec 0014 AC-6, AC-7, AC-8, AC-9, AC-14, AC-17
 *
 * The portal's queries against real PostgreSQL: every visibility rule
 * (archived projects, pending and hidden deliverables, files on an archived
 * project, non client visible invoice statuses), tenant isolation for a
 * contact of a different client of the same agency and a contact of another
 * agency, and paging. Runs inside a transaction that is rolled back
 * afterwards; skipped when `DIRECT_URL` is unset, like the other database
 * suites.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  deliverables,
  invoices,
  memberships,
  organizations,
  projects,
  subscriptions,
  users,
} from "@/db/schema";
import type { ContactContext, TransactionExecutor } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

const state = vi.hoisted(() => ({ tx: undefined as unknown }));

vi.mock("@/db/tenant/executor", () => ({ pooledDb: async () => state.tx }));

const {
  getPortalProject,
  listPortalFiles,
  listPortalInvoices,
  listPortalProjects,
  listProjectFiles,
} = await import("./queries");

loadEnvFiles();

vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DIRECT_URL;

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, { schema });

type Fixture = {
  readonly clientA1: string;
  readonly clientA2: string;
  readonly clientB1: string;
  readonly contactA1: ContactContext;
  readonly contactA2: ContactContext;
  readonly contactB1: ContactContext;
  readonly activeProject: string;
  readonly archivedProject: string;
  readonly a2Project: string;
  readonly b1Project: string;
  readonly visibleFile: string;
  readonly hiddenFile: string;
  readonly pendingFile: string;
  readonly archivedProjectFile: string;
  readonly a2File: string;
  readonly b1File: string;
  readonly sentInvoice: string;
  readonly draftInvoice: string;
  readonly voidInvoice: string;
  readonly paidInvoice: string;
  readonly a2Invoice: string;
  readonly b1Invoice: string;
};

/**
 * Two clients under agency A (one contact each), one client under agency B,
 * one active project and one archived project for A1, plus one project each
 * for A2 and B1, so a contact of A1 has exactly one owning context and two
 * foreign ones to be refused by.
 */
async function seed(tx: TransactionExecutor): Promise<Fixture> {
  const tag = newId().slice(0, 8);
  const orgA = newId();
  const orgB = newId();
  const staffA = newId();
  const staffB = newId();
  const clientA1 = newId();
  const clientA2 = newId();
  const clientB1 = newId();
  const userA1 = newId();
  const userA2 = newId();
  const userB1 = newId();
  const contactRowA1 = newId();
  const contactRowA2 = newId();
  const contactRowB1 = newId();
  const activeProject = newId();
  const archivedProject = newId();
  const a2Project = newId();
  const b1Project = newId();
  const visibleFile = newId();
  const hiddenFile = newId();
  const pendingFile = newId();
  const archivedProjectFile = newId();
  const a2File = newId();
  const b1File = newId();
  const sentInvoice = newId();
  const draftInvoice = newId();
  const voidInvoice = newId();
  const paidInvoice = newId();
  const a2Invoice = newId();
  const b1Invoice = newId();

  await tx.insert(organizations).values([
    {
      id: orgA,
      clerkOrgId: `org_${tag}_a`,
      name: "Agency A",
      slug: `a-${tag}`,
    },
    {
      id: orgB,
      clerkOrgId: `org_${tag}_b`,
      name: "Agency B",
      slug: `b-${tag}`,
    },
  ]);

  await tx.insert(users).values([
    {
      id: staffA,
      clerkUserId: `user_${tag}_staff_a`,
      email: `staff-a-${tag}@example.com`,
    },
    {
      id: staffB,
      clerkUserId: `user_${tag}_staff_b`,
      email: `staff-b-${tag}@example.com`,
    },
    {
      id: userA1,
      clerkUserId: `user_${tag}_a1`,
      email: `a1-${tag}@example.com`,
    },
    {
      id: userA2,
      clerkUserId: `user_${tag}_a2`,
      email: `a2-${tag}@example.com`,
    },
    {
      id: userB1,
      clerkUserId: `user_${tag}_b1`,
      email: `b1-${tag}@example.com`,
    },
  ]);

  await tx.insert(memberships).values([
    { id: newId(), orgId: orgA, userId: staffA, role: "admin" },
    { id: newId(), orgId: orgB, userId: staffB, role: "admin" },
  ]);

  await tx.insert(subscriptions).values([
    {
      id: newId(),
      orgId: orgA,
      stripeCustomerId: `cus_${tag}_a`,
      status: "active",
    },
    {
      id: newId(),
      orgId: orgB,
      stripeCustomerId: `cus_${tag}_b`,
      status: "active",
    },
  ]);

  await tx.insert(clients).values([
    { id: clientA1, orgId: orgA, name: "A first client" },
    { id: clientA2, orgId: orgA, name: "A second client" },
    { id: clientB1, orgId: orgB, name: "B only client" },
  ]);

  await tx.insert(clientContacts).values([
    {
      id: contactRowA1,
      orgId: orgA,
      clientId: clientA1,
      userId: userA1,
      email: `c1-${tag}@example.com`,
      name: "Contact one",
      acceptedAt: new Date(),
    },
    {
      id: contactRowA2,
      orgId: orgA,
      clientId: clientA2,
      userId: userA2,
      email: `c2-${tag}@example.com`,
      name: "Contact two",
      acceptedAt: new Date(),
    },
    {
      id: contactRowB1,
      orgId: orgB,
      clientId: clientB1,
      userId: userB1,
      email: `c3-${tag}@example.com`,
      name: "Contact three",
      acceptedAt: new Date(),
    },
  ]);

  await tx.insert(projects).values([
    {
      id: activeProject,
      orgId: orgA,
      clientId: clientA1,
      name: "Active project",
      dueDate: "2026-12-01",
    },
    {
      id: archivedProject,
      orgId: orgA,
      clientId: clientA1,
      name: "Archived project",
      archivedAt: new Date(),
    },
    { id: a2Project, orgId: orgA, clientId: clientA2, name: "A2 project" },
    { id: b1Project, orgId: orgB, clientId: clientB1, name: "B1 project" },
  ]);

  const file = (
    overrides: Partial<typeof schema.deliverables.$inferInsert> & {
      id: string;
      orgId: string;
      projectId: string;
      name: string;
    },
  ) => ({
    r2Key: `${overrides.id}/${overrides.name}`,
    contentType: "application/pdf",
    sizeBytes: 1024,
    uploadedByUserId: staffA,
    ...overrides,
  });

  await tx.insert(deliverables).values([
    file({
      id: visibleFile,
      orgId: orgA,
      projectId: activeProject,
      name: "visible.pdf",
      status: "ready",
      visibleToClient: true,
    }),
    file({
      id: hiddenFile,
      orgId: orgA,
      projectId: activeProject,
      name: "hidden.pdf",
      status: "ready",
      visibleToClient: false,
    }),
    file({
      id: pendingFile,
      orgId: orgA,
      projectId: activeProject,
      name: "pending.pdf",
      status: "pending",
      visibleToClient: true,
    }),
    file({
      id: archivedProjectFile,
      orgId: orgA,
      projectId: archivedProject,
      name: "archived-project.pdf",
      status: "ready",
      visibleToClient: true,
    }),
    file({
      id: a2File,
      orgId: orgA,
      projectId: a2Project,
      name: "a2.pdf",
      status: "ready",
      visibleToClient: true,
      uploadedByUserId: staffA,
    }),
    file({
      id: b1File,
      orgId: orgB,
      projectId: b1Project,
      name: "b1.pdf",
      status: "ready",
      visibleToClient: true,
      uploadedByUserId: staffB,
    }),
  ]);

  const money = {
    currency: "USD",
    subtotalCents: 1000,
    taxRateBp: 0,
    taxCents: 0,
    totalCents: 1000,
  } as const;

  await tx.insert(invoices).values([
    {
      id: sentInvoice,
      orgId: orgA,
      clientId: clientA1,
      status: "sent",
      number: 1,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      ...money,
    },
    {
      id: draftInvoice,
      orgId: orgA,
      clientId: clientA1,
      status: "draft",
      ...money,
    },
    {
      id: voidInvoice,
      orgId: orgA,
      clientId: clientA1,
      status: "void",
      ...money,
    },
    {
      id: paidInvoice,
      orgId: orgA,
      clientId: clientA1,
      status: "paid",
      number: 2,
      issueDate: "2026-08-01",
      dueDate: "2026-09-01",
      paidAt: new Date("2026-08-20"),
      ...money,
    },
    {
      id: a2Invoice,
      orgId: orgA,
      clientId: clientA2,
      status: "sent",
      number: 3,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      ...money,
    },
    {
      id: b1Invoice,
      orgId: orgB,
      clientId: clientB1,
      status: "sent",
      number: 1,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      ...money,
    },
  ]);

  return {
    clientA1,
    clientA2,
    clientB1,
    contactA1: {
      kind: "contact",
      orgId: orgA,
      userId: userA1,
      clerkUserId: `user_${tag}_a1`,
      clientId: clientA1,
      contactId: contactRowA1,
    },
    contactA2: {
      kind: "contact",
      orgId: orgA,
      userId: userA2,
      clerkUserId: `user_${tag}_a2`,
      clientId: clientA2,
      contactId: contactRowA2,
    },
    contactB1: {
      kind: "contact",
      orgId: orgB,
      userId: userB1,
      clerkUserId: `user_${tag}_b1`,
      clientId: clientB1,
      contactId: contactRowB1,
    },
    activeProject,
    archivedProject,
    a2Project,
    b1Project,
    visibleFile,
    hiddenFile,
    pendingFile,
    archivedProjectFile,
    a2File,
    b1File,
    sentInvoice,
    draftInvoice,
    voidInvoice,
    paidInvoice,
    a2Invoice,
    b1Invoice,
  };
}

async function inRollback(
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      const fixture = await seed(tx);
      state.tx = tx;
      await run(tx, fixture);
      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

describe.skipIf(!url)("portal queries against real PostgreSQL", () => {
  afterAll(async () => {
    await sql.end();
  });

  describe("listPortalProjects (AC-6, AC-14)", () => {
    it("lists the owning contact's non archived projects, never the archived one", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalProjects(fixture.contactA1);

        expect(rows.map((row) => row.name)).toStrictEqual(["Active project"]);
      });
    });

    it("never shows a different client's project to a contact of the same agency", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalProjects(fixture.contactA2);

        // A2's own project is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.id)).toContain(fixture.a2Project);
        expect(rows.map((row) => row.id)).not.toContain(fixture.activeProject);
      });
    });

    it("never shows another agency's project", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalProjects(fixture.contactB1);

        // B1's own project is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.id)).toContain(fixture.b1Project);
        expect(rows.map((row) => row.id)).not.toContain(fixture.activeProject);
      });
    });

    it("pages at 25, with the 26th project on page 2", async () => {
      await inRollback(async (tx, fixture) => {
        await tx.insert(projects).values(
          Array.from({ length: 26 }, (_, index) => ({
            id: newId(),
            orgId: fixture.contactA1.orgId,
            clientId: fixture.clientA1,
            name: `Paging project ${String(index).padStart(2, "0")}`,
            dueDate: "2026-11-01",
          })),
        );

        const page1 = await listPortalProjects(fixture.contactA1, 1);
        const page2 = await listPortalProjects(fixture.contactA1, 2);

        // 26 paging projects, plus the one "Active project" from the fixture.
        expect(page1.total).toBe(27);
        expect(page1.pageCount).toBe(2);
        expect(page1.rows).toHaveLength(25);
        expect(page2.rows).toHaveLength(2);
      });
    });
  });

  describe("getPortalProject (AC-7, AC-14)", () => {
    it("returns the project for the owning contact", async () => {
      await inRollback(async (_tx, fixture) => {
        const project = await getPortalProject(
          fixture.contactA1,
          fixture.activeProject,
        );

        expect(project?.name).toBe("Active project");
      });
    });

    it("is undefined for the archived project, even to its own client's contact", async () => {
      await inRollback(async (_tx, fixture) => {
        expect(
          await getPortalProject(fixture.contactA1, fixture.archivedProject),
        ).toBeUndefined();
      });
    });

    it("is undefined for a contact of a different client of the same agency", async () => {
      await inRollback(async (_tx, fixture) => {
        expect(
          await getPortalProject(fixture.contactA2, fixture.activeProject),
        ).toBeUndefined();
      });
    });

    it("is undefined for a contact of another agency", async () => {
      await inRollback(async (_tx, fixture) => {
        expect(
          await getPortalProject(fixture.contactB1, fixture.activeProject),
        ).toBeUndefined();
      });
    });

    it("is undefined for a non uuid", async () => {
      await inRollback(async (_tx, fixture) => {
        expect(
          await getPortalProject(fixture.contactA1, "not-a-uuid"),
        ).toBeUndefined();
      });
    });
  });

  describe("listProjectFiles and listPortalFiles (AC-8, AC-14)", () => {
    it("shows only the ready, visible file on the active project", async () => {
      await inRollback(async (_tx, fixture) => {
        const files = await listProjectFiles(
          fixture.contactA1,
          fixture.activeProject,
        );

        expect(files.map((file) => file.name)).toStrictEqual(["visible.pdf"]);
      });
    });

    it("never shows a hidden or a pending file", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalFiles(fixture.contactA1);
        const names = rows.map((row) => row.name);

        expect(names).not.toContain("hidden.pdf");
        expect(names).not.toContain("pending.pdf");
      });
    });

    it("never shows a file on an archived project", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalFiles(fixture.contactA1);

        expect(rows.map((row) => row.name)).not.toContain(
          "archived-project.pdf",
        );
      });
    });

    it("never shows a different client's file to a contact of the same agency", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalFiles(fixture.contactA2);

        // A2's own file is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.name)).toContain("a2.pdf");
        expect(rows.map((row) => row.name)).not.toContain("visible.pdf");
      });
    });

    it("never shows another agency's file", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalFiles(fixture.contactB1);

        // B1's own file is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.name)).toContain("b1.pdf");
        expect(rows.map((row) => row.name)).not.toContain("visible.pdf");
      });
    });

    it("pages at 25, with the 26th file on page 2", async () => {
      await inRollback(async (tx, fixture) => {
        await tx.insert(deliverables).values(
          Array.from({ length: 26 }, (_, index) => ({
            id: newId(),
            orgId: fixture.contactA1.orgId,
            projectId: fixture.activeProject,
            name: `paging-${String(index).padStart(2, "0")}.pdf`,
            r2Key: `paging/${index}`,
            contentType: "application/pdf",
            sizeBytes: 1,
            uploadedByUserId: fixture.contactA1.userId,
            status: "ready" as const,
            visibleToClient: true,
          })),
        );

        const page1 = await listPortalFiles(fixture.contactA1, 1);
        const page2 = await listPortalFiles(fixture.contactA1, 2);

        // 26 paging files, plus the one "visible.pdf" from the fixture.
        expect(page1.total).toBe(27);
        expect(page1.pageCount).toBe(2);
        expect(page1.rows).toHaveLength(25);
        expect(page2.rows).toHaveLength(2);
      });
    });
  });

  describe("listPortalInvoices (AC-9, AC-14)", () => {
    it("shows only the client visible statuses for the owning contact", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalInvoices(fixture.contactA1);

        expect(rows.map((row) => row.number).sort()).toStrictEqual([1, 2]);
      });
    });

    it("never shows a draft or a void invoice", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalInvoices(fixture.contactA1);
        const ids = rows.map((row) => row.id);

        expect(ids).not.toContain(fixture.draftInvoice);
        expect(ids).not.toContain(fixture.voidInvoice);
      });
    });

    it("never shows a different client's invoice to a contact of the same agency", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalInvoices(fixture.contactA2);

        // A2's own invoice is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.id)).toContain(fixture.a2Invoice);
        expect(rows.map((row) => row.id)).not.toContain(fixture.sentInvoice);
      });
    });

    it("never shows another agency's invoice", async () => {
      await inRollback(async (_tx, fixture) => {
        const { rows } = await listPortalInvoices(fixture.contactB1);

        // B1's own invoice is expected; A1's is not (AC-14).
        expect(rows.map((row) => row.id)).toContain(fixture.b1Invoice);
        expect(rows.map((row) => row.id)).not.toContain(fixture.sentInvoice);
      });
    });
  });
});
