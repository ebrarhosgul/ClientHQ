/**
 * covers: spec 0014 AC-4, spec 0004 AC-22
 *
 * `portalContext` and `listAcceptedContactRows` are mocked (each has its own
 * tests), and the chrome pieces (`PortalTopBar`, `SectionNav`) are stubbed to
 * a div recording their props, since each has its own render tests. This
 * file is about `ContactLayout`'s own job: passing children through with no
 * chrome and no query at all when Clerk has no key (AC-22, mirroring the
 * agency gate's own pass through), and otherwise resolving the context once
 * and wiring the top bar's props from it.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContext: vi.fn(),
  listAcceptedContactRows: vi.fn(),
  PortalTopBar: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({ portalContext: mocks.portalContext }));
vi.mock("@/db/tenant", () => ({
  listAcceptedContactRows: mocks.listAcceptedContactRows,
}));
vi.mock("@/portal/ui/portal-top-bar", () => ({
  PortalTopBar: (props: Record<string, unknown>) => {
    mocks.PortalTopBar(props);

    return <div data-testid="portal-top-bar" />;
  },
}));
vi.mock("@/portal/ui/section-nav", () => ({
  SectionNav: () => <nav data-testid="section-nav" />,
}));

const { default: ContactLayout } = await import("./layout");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

const ROWS = [
  {
    contactId: "contact-1",
    clientId: "client-1",
    clientName: "Northwind Coffee",
    orgId: "org-1",
    agencyName: "Acme Agency",
  },
];

/** The generated `LayoutProps<"/portal">` type is not available outside a Next build. */
async function renderLayout(children: React.ReactNode) {
  const Layout = ContactLayout as unknown as (props: {
    children: React.ReactNode;
  }) => Promise<React.ReactNode>;

  return render(<>{await Layout({ children })}</>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContext.mockResolvedValue({
    ctx: CTX,
    access: { level: "full" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.listAcceptedContactRows.mockResolvedValue(ROWS);
});

describe("ContactLayout", () => {
  it("returns its children untouched with no Clerk key, reading neither the context nor the rows (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderLayout(<p>page content</p>);

    expect(mocks.portalContext).not.toHaveBeenCalled();
    expect(mocks.listAcceptedContactRows).not.toHaveBeenCalled();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-top-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-nav")).not.toBeInTheDocument();
  });

  it("renders the chrome around the page, with the resolved names and rows (AC-4)", async () => {
    await renderLayout(<p>page content</p>);

    expect(screen.getByTestId("portal-top-bar")).toBeInTheDocument();
    expect(screen.getByTestId("section-nav")).toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(mocks.PortalTopBar).toHaveBeenCalledWith({
      clientName: "Northwind Coffee",
      rows: ROWS,
      currentContactId: "contact-1",
    });
  });

  it("reads this contact's own rows for the switcher, by user id", async () => {
    await renderLayout(<p>page content</p>);

    expect(mocks.listAcceptedContactRows).toHaveBeenCalledWith("user-1");
  });

  it("lets a failed context resolution propagate, rendering no chrome", async () => {
    const outage = new Error("connection refused");
    mocks.portalContext.mockRejectedValue(outage);

    await expect(renderLayout(<p>page content</p>)).rejects.toBe(outage);
    expect(mocks.listAcceptedContactRows).not.toHaveBeenCalled();
  });
});
