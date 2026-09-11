/**
 * covers: spec 0006 AC-6, AC-8, AC-9, AC-11, spec 0004 AC-22
 *
 * `getClient` is mocked (it has its own tests); this file is about which
 * fields `ClientDetailPage` shows, which of the archive/restore buttons it
 * renders, and that a missing client -- which includes another agency's id,
 * and every id at all with no Clerk session -- resolves not found rather
 * than a permission error or a blank page (AC-11).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/clients/queries", async (importActual) => {
  const actual = await importActual<typeof import("@/clients/queries")>();
  return { ...actual, getClient: mocks.getClient };
});
vi.mock("@/clients/ui/archive-client-button", () => ({
  ArchiveClientButton: () => <button type="button">Archive</button>,
}));
vi.mock("@/clients/ui/restore-client-button", () => ({
  RestoreClientButton: () => <button type="button">Restore</button>,
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
  });
});
