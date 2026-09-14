/**
 * covers: spec 0006 AC-6, AC-8, AC-9, AC-11, spec 0004 AC-22
 *
 * `getClient` and `listProjectsForClient` are mocked (they have their own
 * tests); this file is about which fields `ClientDetailPage` shows, which of
 * the archive/restore buttons it renders, that a missing client -- which
 * includes another agency's id, and every id at all with no Clerk session --
 * resolves not found rather than a permission error or a blank page (AC-11),
 * and that the client's projects are read once for both the Projects section
 * and the archive confirm's count, with a failed read contained to those two
 * (spec 0010, AC-13, AC-14).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  getClient: vi.fn(),
  listProjectsForClient: vi.fn(),
  ArchiveClientButton: vi.fn(),
  ProjectsSection: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/clients/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/clients/queries")>();
  return { ...actual, getClient: mocks.getClient };
});
vi.mock("@/projects/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/projects/queries")>();
  return { ...actual, listProjectsForClient: mocks.listProjectsForClient };
});
vi.mock("@/clients/ui/archive-client-button", () => ({
  ArchiveClientButton: (props: unknown) => {
    mocks.ArchiveClientButton(props);
    return <button type="button">Archive</button>;
  },
}));
vi.mock("@/clients/ui/restore-client-button", () => ({
  RestoreClientButton: () => <button type="button">Restore</button>,
}));
// The Contacts section runs its own scoped query and has its own tests; the
// Projects section is handed its rows by this page and has its own tests too.
vi.mock("@/contacts/ui/contacts-section", () => ({
  ContactsSection: () => <section aria-label="Contacts" />,
}));
vi.mock("@/projects/ui/projects-section", () => ({
  ProjectsSection: (props: unknown) => {
    mocks.ProjectsSection(props);
    return <section aria-label="Projects" />;
  },
}));

const { default: ClientDetailPage } = await import("./page");

const ACTIVE_CLIENT = {
  id: "client-1",
  name: "Northwind Coffee",
  companyEmail: "hello@northwind.example",
  phone: "555-0100",
  industry: "Coffee roasting",
  notes: "Prefers email",
  billingAddressLine1: "1 Main St",
  billingAddressLine2: null,
  billingCity: "Portland",
  billingRegion: "OR",
  billingPostalCode: "97201",
  billingCountry: "USA",
  archivedAt: null,
};

async function renderPage(id = "client-1") {
  return render(
    await ClientDetailPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve({}),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.listProjectsForClient.mockResolvedValue([]);
});

describe("ClientDetailPage", () => {
  it("shows every field and the Archive action for an active client (AC-6)", async () => {
    mocks.getClient.mockResolvedValue(ACTIVE_CLIENT);

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Northwind Coffee" }),
    ).toBeInTheDocument();
    expect(screen.getByText("hello@northwind.example")).toBeInTheDocument();
    expect(screen.getByText("Portland")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  });

  it("shows a dash for every field left blank", async () => {
    mocks.getClient.mockResolvedValue({
      ...ACTIVE_CLIENT,
      companyEmail: null,
      phone: null,
    });

    await renderPage();

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the Archived badge and the Restore action for an archived client (AC-9)", async () => {
    mocks.getClient.mockResolvedValue({
      ...ACTIVE_CLIENT,
      archivedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await renderPage();

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
  });

  it("resolves not found for a missing client, the same as a foreign agency's id (AC-11)", async () => {
    mocks.getClient.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-client")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.getClient).toHaveBeenCalledWith(
      { orgId: "org-1" },
      "someone-elses-client",
    );
  });

  it("resolves not found with no Clerk session, never resolving a query at all (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(renderPage()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.listProjectsForClient).not.toHaveBeenCalled();
  });

  it("reads the client's projects once, for both the section and the archive confirm's count (spec 0010, AC-13, AC-14)", async () => {
    const projects = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    mocks.getClient.mockResolvedValue(ACTIVE_CLIENT);
    mocks.listProjectsForClient.mockResolvedValue(projects);

    await renderPage();

    expect(mocks.listProjectsForClient).toHaveBeenCalledTimes(1);
    expect(mocks.listProjectsForClient).toHaveBeenCalledWith(
      { orgId: "org-1" },
      "client-1",
      expect.any(String),
    );
    expect(mocks.ProjectsSection).toHaveBeenCalledWith(
      expect.objectContaining({ projects }),
    );
    expect(mocks.ArchiveClientButton).toHaveBeenCalledWith(
      expect.objectContaining({ activeProjectCount: 3 }),
    );
  });

  it("contains a failed projects read: the section gets no rows, the count falls back to zero, the rest of the page renders", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getClient.mockResolvedValue(ACTIVE_CLIENT);
    mocks.listProjectsForClient.mockRejectedValue(
      new Error("connection reset"),
    );

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Northwind Coffee" }),
    ).toBeInTheDocument();
    expect(mocks.ProjectsSection).toHaveBeenCalledWith(
      expect.objectContaining({ projects: undefined }),
    );
    expect(mocks.ArchiveClientButton).toHaveBeenCalledWith(
      expect.objectContaining({ activeProjectCount: 0 }),
    );

    errorSpy.mockRestore();
  });

  it("lets a tenant resolution failure on the projects read propagate to the layout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolutionFailure = Object.assign(new Error("no session"), {
      name: "TenantResolutionError",
    });
    mocks.getClient.mockResolvedValue(ACTIVE_CLIENT);
    mocks.listProjectsForClient.mockRejectedValue(resolutionFailure);

    await expect(renderPage()).rejects.toThrow(resolutionFailure);

    errorSpy.mockRestore();
  });
});
