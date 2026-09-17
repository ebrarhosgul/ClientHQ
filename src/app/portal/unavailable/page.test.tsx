/**
 * covers: spec 0014 AC-2, AC-3, spec 0004 AC-22
 *
 * `portalContextForUnavailable` and `listAcceptedContactRows` are mocked
 * (each has its own tests); `ClientSwitcher` and `PortalSignOutLink` are
 * stubbed, since each has its own render tests. This file is about the one
 * thing only this page does: the reverse gate. AC-2 rests on a contact never
 * being stranded here once their agency becomes readable again (or they
 * switch to a client whose agency already is); this page is the only place
 * that redirect lives, and it had no test at all before this file.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  portalContextForUnavailable: vi.fn(),
  listAcceptedContactRows: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/portal/context", () => ({
  portalContextForUnavailable: mocks.portalContextForUnavailable,
}));
vi.mock("@/db/tenant", () => ({
  listAcceptedContactRows: mocks.listAcceptedContactRows,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(REDIRECTED);
  },
}));
vi.mock("@/portal/ui/client-switcher", () => ({
  ClientSwitcher: () => <div data-testid="client-switcher" />,
}));
vi.mock("@/portal/ui/portal-sign-out-link", () => ({
  PortalSignOutLink: () => <button type="button">Sign out</button>,
}));
vi.mock("@/ui/patterns/theme-control", () => ({
  ThemeControl: () => <div data-testid="theme-control" />,
}));

const { default: PortalUnavailablePage } = await import("./page");

const CTX = {
  kind: "contact" as const,
  orgId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-user-1",
  clientId: "client-1",
  contactId: "contact-1",
};

async function renderPage() {
  return render(await PortalUnavailablePage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.portalContextForUnavailable.mockResolvedValue({
    ctx: CTX,
    access: { level: "locked" },
    clientName: "Northwind Coffee",
    agencyName: "Acme Agency",
  });
  mocks.listAcceptedContactRows.mockResolvedValue([
    {
      contactId: "contact-1",
      clientId: "client-1",
      clientName: "Northwind Coffee",
      orgId: "org-1",
      agencyName: "Acme Agency",
    },
  ]);
});

describe("PortalUnavailablePage", () => {
  it("renders the generic, session free frame with no Clerk key, reading nothing (AC-22)", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await renderPage();

    expect(mocks.portalContextForUnavailable).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Portal unavailable" }),
    ).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["locked", "unsubscribed"] as const)(
    "renders the unavailable copy and sign out for a still unreadable level (%s) (AC-3)",
    async (level) => {
      mocks.portalContextForUnavailable.mockResolvedValue({
        ctx: CTX,
        access: { level },
        clientName: "Northwind Coffee",
        agencyName: "Acme Agency",
      });

      await renderPage();

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(
        screen.getByText("This portal is not available right now"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Sign out" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["full", "grace"] as const)(
    "sends a now readable contact back to /portal instead of stranding them here (%s) (AC-2)",
    async (level) => {
      mocks.portalContextForUnavailable.mockResolvedValue({
        ctx: CTX,
        access: { level },
        clientName: "Northwind Coffee",
        agencyName: "Acme Agency",
      });

      await expect(renderPage()).rejects.toThrow(REDIRECTED);

      expect(mocks.redirect).toHaveBeenCalledWith("/portal");
      expect(mocks.listAcceptedContactRows).not.toHaveBeenCalled();
    },
  );

  it("shows the switcher once this contact has more than one accepted client", async () => {
    mocks.listAcceptedContactRows.mockResolvedValue([
      {
        contactId: "contact-1",
        clientId: "client-1",
        clientName: "Northwind Coffee",
        orgId: "org-1",
        agencyName: "Acme Agency",
      },
      {
        contactId: "contact-2",
        clientId: "client-2",
        clientName: "Old Harbor",
        orgId: "org-2",
        agencyName: "Other Agency",
      },
    ]);

    await renderPage();

    expect(screen.getByTestId("client-switcher")).toBeInTheDocument();
    expect(screen.queryByText("Northwind Coffee")).not.toBeInTheDocument();
  });

  it("shows the plain client name, not the switcher, with exactly one accepted row", async () => {
    await renderPage();

    expect(screen.queryByTestId("client-switcher")).not.toBeInTheDocument();
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
  });

  it("lets a failed context resolution propagate rather than settling on a level", async () => {
    const outage = new Error("connection refused");
    mocks.portalContextForUnavailable.mockRejectedValue(outage);

    await expect(renderPage()).rejects.toBe(outage);
  });
});
