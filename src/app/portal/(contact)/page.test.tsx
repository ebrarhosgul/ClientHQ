/**
 * covers: spec 0014 AC-5, spec 0004 AC-22
 *
 * `portalContext` and `overviewData` are mocked (each has its own tests);
 * this file is about which of the three blocks' empty state versus rows
 * `PortalOverviewPage` shows, for a given result, and that it renders the
 * same empty overview with no Clerk key at all rather than resolving a
 * context that cannot exist (AC-22).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  overviewData: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/portal/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/portal/queries")>();
  return { ...actual, overviewData: mocks.overviewData };
});

const { default: PortalOverviewPage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

async function renderPage() {
  return render(await PortalOverviewPage());
}

const PROJECT = {
  id: "project-1",
  name: "Website relaunch",
  description: "New marketing site",
  status: "in_progress" as const,
  dueDate: "2020-01-01",
  overdue: true,
};

const FILE = {
  id: "file-1",
  name: "brand-guide.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  projectId: "project-1",
  projectName: "Website relaunch",
};

const INVOICE = {
  id: "invoice-1",
  number: 1,
  status: "sent" as const,
  issueDate: "2026-08-01",
  dueDate: "2026-09-01",
  totalCents: 15000,
  currency: "USD",
  pastDue: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContext.mockResolvedValue({
    ctx: CTX,
    access: { level: "full" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.overviewData.mockResolvedValue({
    projects: [PROJECT],
    files: [FILE],
    invoices: [INVOICE],
  });
});

describe("PortalOverviewPage", () => {
  it("renders every block empty with no Clerk key, never resolving a context or a query (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.overviewData).not.toHaveBeenCalled();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("No files shared yet")).toBeInTheDocument();
    expect(
      screen.getByText("No invoices awaiting payment"),
    ).toBeInTheDocument();
  });

  it("reads the overview for the resolved contact", async () => {
    await renderPage();

    expect(mocks.overviewData).toHaveBeenCalledWith(CTX);
  });

  it("shows a row per block, with the overdue badge on a project past its due date (AC-5)", async () => {
    await renderPage();

    const projectLinks = screen.getAllByRole("link", {
      name: "Website relaunch",
    });
    expect(projectLinks.map((link) => link.getAttribute("href"))).toContain(
      "/portal/projects/project-1",
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "brand-guide.pdf" }),
    ).toHaveAttribute("href", "/deliverables/file-1/download");
    expect(screen.getByRole("link", { name: "INV-0001" })).toHaveAttribute(
      "href",
      "/portal/invoices/invoice-1",
    );
  });

  it("shows the empty state for a block with no rows, independently of the others", async () => {
    mocks.overviewData.mockResolvedValue({
      projects: [],
      files: [FILE],
      invoices: [],
    });

    await renderPage();

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("brand-guide.pdf")).toBeInTheDocument();
    expect(
      screen.getByText("No invoices awaiting payment"),
    ).toBeInTheDocument();
  });

  it("lets a failed read propagate rather than rendering a partial overview", async () => {
    const outage = new Error("connection refused");
    mocks.overviewData.mockRejectedValue(outage);

    await expect(renderPage()).rejects.toBe(outage);
  });
});
