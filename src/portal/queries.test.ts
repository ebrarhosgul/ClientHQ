/**
 * covers: spec 0014 AC-6, AC-8, AC-9, AC-17
 *
 * The pure comparator and grouping logic behind `/portal/invoices`,
 * `/portal/projects` and `/portal/files`. The queries themselves, and their
 * tenancy scoping, are proven against real PostgreSQL in `queries.db.test.ts`
 * (AC-14).
 */
import { describe, expect, it } from "vitest";

import {
  compareInvoicesForPortal,
  compareProjectsForPortal,
  groupFilesByProject,
  type PortalFileRow,
  type PortalInvoiceRow,
  type PortalProjectRow,
} from "./queries";

function row(overrides: Partial<PortalInvoiceRow>): PortalInvoiceRow {
  return {
    id: "row",
    number: 1,
    status: "sent",
    issueDate: "2026-08-01",
    dueDate: "2026-08-31",
    totalCents: 10000,
    currency: "USD",
    pastDue: false,
    ...overrides,
  };
}

describe("compareInvoicesForPortal (AC-9)", () => {
  it("puts sent and overdue before paid", () => {
    const paid = row({ id: "paid", status: "paid", number: 1 });
    const sent = row({ id: "sent", status: "sent", number: 2 });
    const overdue = row({ id: "overdue", status: "overdue", number: 3 });

    expect(compareInvoicesForPortal(sent, paid)).toBeLessThan(0);
    expect(compareInvoicesForPortal(overdue, paid)).toBeLessThan(0);
    expect(compareInvoicesForPortal(paid, sent)).toBeGreaterThan(0);
  });

  it("within a group, sorts by issue date newest first", () => {
    const older = row({ id: "older", issueDate: "2026-07-01" });
    const newer = row({ id: "newer", issueDate: "2026-08-01" });

    expect(compareInvoicesForPortal(newer, older)).toBeLessThan(0);
    expect(compareInvoicesForPortal(older, newer)).toBeGreaterThan(0);
  });

  it("breaks a tied issue date by number descending", () => {
    const low = row({ id: "low", number: 1, issueDate: "2026-08-01" });
    const high = row({ id: "high", number: 2, issueDate: "2026-08-01" });

    expect(compareInvoicesForPortal(high, low)).toBeLessThan(0);
  });
});

function project(overrides: Partial<PortalProjectRow>): PortalProjectRow {
  return {
    id: "project",
    name: "Project",
    description: null,
    status: "planning",
    dueDate: "2026-08-31",
    overdue: false,
    ...overrides,
  };
}

describe("compareProjectsForPortal (AC-6)", () => {
  it("puts a project due sooner before one due later", () => {
    const soon = project({ id: "soon", dueDate: "2026-08-01" });
    const later = project({ id: "later", dueDate: "2026-09-01" });

    expect(compareProjectsForPortal(soon, later)).toBeLessThan(0);
    expect(compareProjectsForPortal(later, soon)).toBeGreaterThan(0);
  });

  it("puts a project with no due date last, whatever the other one's date", () => {
    const dated = project({ id: "dated", dueDate: "2026-08-01" });
    const undated = project({ id: "undated", dueDate: null });

    expect(compareProjectsForPortal(dated, undated)).toBeLessThan(0);
    expect(compareProjectsForPortal(undated, dated)).toBeGreaterThan(0);
  });

  it("breaks a tied due date, and a tie between two undated projects, by name", () => {
    const a = project({ id: "a", name: "Alpha", dueDate: "2026-08-01" });
    const b = project({ id: "b", name: "Beta", dueDate: "2026-08-01" });

    expect(compareProjectsForPortal(a, b)).toBeLessThan(0);

    const undatedA = project({ id: "a", name: "Alpha", dueDate: null });
    const undatedB = project({ id: "b", name: "Beta", dueDate: null });

    expect(compareProjectsForPortal(undatedA, undatedB)).toBeLessThan(0);
  });
});

function file(overrides: Partial<PortalFileRow>): PortalFileRow {
  return {
    id: "file",
    name: "file.pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    projectId: "project",
    projectName: "Project",
    ...overrides,
  };
}

describe("groupFilesByProject (AC-8)", () => {
  it("groups consecutive files under one project", () => {
    const rows = [
      file({ id: "1", projectId: "p1", projectName: "One" }),
      file({ id: "2", projectId: "p1", projectName: "One" }),
    ];

    const groups = groupFilesByProject(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ projectId: "p1", projectName: "One" });
    expect(groups[0]!.files.map((row) => row.id)).toStrictEqual(["1", "2"]);
  });

  it("orders groups by each group's newest (first seen) file, even when a later project's files are interleaved", () => {
    const rows = [
      file({ id: "1", projectId: "p1" }),
      file({ id: "2", projectId: "p2" }),
      file({ id: "3", projectId: "p1" }),
    ];

    const groups = groupFilesByProject(rows);

    expect(groups.map((group) => group.projectId)).toStrictEqual(["p1", "p2"]);
    expect(groups[0]!.files.map((row) => row.id)).toStrictEqual(["1", "3"]);
    expect(groups[1]!.files.map((row) => row.id)).toStrictEqual(["2"]);
  });

  it("is empty for an empty page", () => {
    expect(groupFilesByProject([])).toStrictEqual([]);
  });
});
