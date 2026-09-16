/**
 * covers: spec 0012 AC-1, AC-13, spec 0004 AC-22
 *
 * `listClientOptions`, `currentAgency` and `NewInvoiceForm` are all mocked
 * (each has its own tests); this file is about `NewInvoicePage`'s own job:
 * showing a sign in prompt with no Clerk session, an empty state with no
 * active clients at all, only forwarding `?client=` as a preselection when it
 * names one of the options actually offered (AC-1, AC-13), and falling back
 * to USD when the agency's currency cannot be read.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  currentAgency: vi.fn(),
  listClientOptions: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/auth/context", () => ({
  agencyContext: mocks.agencyContext,
  currentAgency: mocks.currentAgency,
}));
vi.mock("@/clients/queries", () => ({
  listClientOptions: mocks.listClientOptions,
}));
vi.mock("@/invoices/ui/new-invoice-form", () => ({
  NewInvoiceForm: (props: Record<string, unknown>) => (
    <div data-testid="new-invoice-form">{JSON.stringify(props)}</div>
  ),
}));

const { default: NewInvoicePage } = await import("./page");

async function renderAwaited(searchParams: Record<string, string> = {}) {
  return render(
    await NewInvoicePage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

const CLIENT_OPTIONS = [
  { id: "client-1", name: "Northwind Coffee" },
  { id: "client-2", name: "Acme" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
  mocks.currentAgency.mockResolvedValue({ defaultCurrency: "EUR" });
  mocks.listClientOptions.mockResolvedValue(CLIENT_OPTIONS);
});

describe("NewInvoicePage", () => {
  it("shows the create form with the agency's active clients and currency (AC-1)", async () => {
    await renderAwaited();

    expect(screen.getByTestId("new-invoice-form")).toBeInTheDocument();
    expect(mocks.listClientOptions).toHaveBeenCalledWith({ orgId: "org-1" });

    const props = JSON.parse(
      screen.getByTestId("new-invoice-form").textContent ?? "{}",
    );
    expect(props.defaultCurrency).toBe("EUR");
  });

  it("preselects the client named by ?client= when it resolves (AC-1, AC-13)", async () => {
    await renderAwaited({ client: "client-2" });

    const props = JSON.parse(
      screen.getByTestId("new-invoice-form").textContent ?? "{}",
    );
    expect(props.preselectedClientId).toBe("client-2");
  });

  it("does not preselect a client id that is not one of the options", async () => {
    await renderAwaited({ client: "someone-elses-client" });

    const props = JSON.parse(
      screen.getByTestId("new-invoice-form").textContent ?? "{}",
    );
    expect(props.preselectedClientId).toBeUndefined();
  });

  it("falls back to USD when the agency's currency cannot be read", async () => {
    mocks.currentAgency.mockResolvedValue(undefined);

    await renderAwaited();

    const props = JSON.parse(
      screen.getByTestId("new-invoice-form").textContent ?? "{}",
    );
    expect(props.defaultCurrency).toBe("USD");
  });

  it("shows an empty state with no active clients, and no form", async () => {
    mocks.listClientOptions.mockResolvedValue([]);

    await renderAwaited();

    expect(screen.getByText("Add a client first")).toBeInTheDocument();
    expect(screen.queryByTestId("new-invoice-form")).not.toBeInTheDocument();
  });

  it("shows a sign in prompt instead of a form with no Clerk credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(mocks.listClientOptions).not.toHaveBeenCalled();
    expect(mocks.currentAgency).not.toHaveBeenCalled();
    expect(
      screen.getByText("Sign in to create an invoice"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("new-invoice-form")).not.toBeInTheDocument();
  });

  it("gives the page its one heading either way", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderAwaited();

    expect(
      screen.getByRole("heading", { level: 1, name: "New invoice" }),
    ).toBeInTheDocument();
  });
});
