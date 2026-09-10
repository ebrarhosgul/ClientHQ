/**
 * covers: spec 0006 AC-7, AC-11, spec 0004 AC-22
 *
 * `getClient` and `ClientForm` are both mocked (each has its own tests); this
 * file is about `EditClientPage`'s own job: handing the found client to the
 * form, and resolving not found -- the same outcome for a missing id, a
 * foreign agency's id, and every id at all with no Clerk session.
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
vi.mock("@/clients/ui/client-form", () => ({
  ClientForm: ({ client }: { readonly client?: { readonly name: string } }) => (
    <div data-testid="client-form">{client?.name}</div>
  ),
}));

const { default: EditClientPage } = await import("./page");

async function renderPage(id = "client-1") {
  return render(
    await EditClientPage({
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

describe("EditClientPage", () => {
  it("hands the found client to the form, pre-filled (AC-7)", async () => {
    mocks.getClient.mockResolvedValue({ id: "client-1", name: "Northwind" });

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Edit Northwind" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("client-form")).toHaveTextContent("Northwind");
  });

  it("resolves not found for a missing client, the same as a foreign agency's id (AC-11)", async () => {
    mocks.getClient.mockResolvedValue(undefined);

    await expect(renderPage("someone-elses-client")).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
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
