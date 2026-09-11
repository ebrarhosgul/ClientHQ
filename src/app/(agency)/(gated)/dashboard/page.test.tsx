/**
 * covers: spec 0005 AC-15, spec 0004 AC-22
 *
 * Where signed in agency staff land. `AgencyWelcome` is stubbed (it has its
 * own render tests); this file is about whether the panel appears at all, and
 * with which values, which turns on `isClerkConfigured()` and on whether the
 * agency's own row resolved.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  agencyContext: vi.fn(),
  currentAgency: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/auth/context", () => ({
  agencyContext: mocks.agencyContext,
  currentAgency: mocks.currentAgency,
}));

vi.mock("@/auth/ui/agency-welcome", () => ({
  AgencyWelcome: ({
    name,
    role,
    currency,
  }: {
    name: string;
    role: string;
    currency: string;
  }) => <div data-testid="agency-welcome">{`${name}:${role}:${currency}`}</div>,
}));

const { default: DashboardPage } = await import("./page");

async function renderPage() {
  return render(await DashboardPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.agencyContext.mockResolvedValue({ role: "admin" });
  mocks.currentAgency.mockResolvedValue({
    name: "Northwind",
    defaultCurrency: "USD",
  });
});

describe("DashboardPage", () => {
  it("shows the welcome panel with the resolved agency (AC-15)", async () => {
    await renderPage();

    expect(screen.getByTestId("agency-welcome")).toHaveTextContent(
      "Northwind:admin:USD",
    );
  });

  it("renders with no session at all when Clerk has no credentials (spec 0004, AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(mocks.agencyContext).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agency-welcome")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
  });

  it("omits the welcome panel when the agency's own row has not landed yet", async () => {
    mocks.currentAgency.mockResolvedValue(undefined);

    await renderPage();

    expect(screen.queryByTestId("agency-welcome")).not.toBeInTheDocument();
  });

  it("always shows the empty state placeholder for the rest of the page", async () => {
    await renderPage();

    expect(screen.getByText("Nothing to show yet")).toBeInTheDocument();
  });
});
