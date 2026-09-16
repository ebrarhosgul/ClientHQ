/**
 * covers: spec 0014 AC-4, AC-5, AC-11, AC-15
 *
 * The portal's own shell pieces: the top bar's plain text and switcher
 * branches, the section strip, the switcher's refusal copy, the empty state,
 * and the overview's own section wrapper, each with an axe check in both
 * themes.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptedContactRow } from "@/db/tenant";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

vi.mock("@/ui/patterns/theme-control", () => ({
  ThemeControl: () => <div data-testid="theme-control" />,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/projects",
}));

const mocks = vi.hoisted(() => ({ switchContact: vi.fn() }));

vi.mock("../switch-contact", () => ({ switchContact: mocks.switchContact }));

const { PortalTopBar } = await import("./portal-top-bar");
const { SectionNav } = await import("./section-nav");
const { ClientSwitcher } = await import("./client-switcher");
const { PortalEmptyState } = await import("./portal-empty-state");
const { OverviewSection } = await import("./overview-section");

const ONE_ROW: readonly AcceptedContactRow[] = [
  {
    contactId: "contact-1",
    clientId: "client-1",
    orgId: "org-1",
    clientName: "Northwind",
    agencyName: "Studio North",
  },
];

const TWO_ROWS: readonly AcceptedContactRow[] = [
  ...ONE_ROW,
  {
    contactId: "contact-2",
    clientId: "client-2",
    orgId: "org-2",
    clientName: "Cinder Media",
    agencyName: "Anchor Ridge",
  },
];

beforeEach(() => {
  mocks.switchContact.mockReset();
});

describe("PortalTopBar", () => {
  it("is a labelled banner landmark", () => {
    render(
      <PortalTopBar
        clientName="Northwind"
        rows={ONE_ROW}
        currentContactId="contact-1"
      />,
    );

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("shows the client name as a plain link with one accepted row (AC-11)", () => {
    render(
      <PortalTopBar
        clientName="Northwind"
        rows={ONE_ROW}
        currentContactId="contact-1"
      />,
    );

    expect(screen.getByRole("link", { name: "Northwind" })).toHaveAttribute(
      "href",
      "/portal",
    );
    expect(
      screen.queryByRole("button", { name: /Switch client/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the Switch client menu with more than one accepted row (AC-11)", () => {
    render(
      <PortalTopBar
        clientName="Northwind"
        rows={TWO_ROWS}
        currentContactId="contact-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: /Switch client/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Northwind" }),
    ).not.toBeInTheDocument();
  });

  it.each(THEMES)(
    "has no axe violation with one row, in the %s theme",
    async (theme) => {
      const { container } = render(
        <PortalTopBar
          clientName="Northwind"
          rows={ONE_ROW}
          currentContactId="contact-1"
        />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );

  it.each(THEMES)(
    "has no axe violation with the switcher, in the %s theme",
    async (theme) => {
      const { container } = render(
        <PortalTopBar
          clientName="Northwind"
          rows={TWO_ROWS}
          currentContactId="contact-1"
        />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});

describe("SectionNav", () => {
  it("is a labelled navigation landmark with the three sections in order", () => {
    render(<SectionNav />);

    const nav = screen.getByRole("navigation", { name: "Portal sections" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Projects", "Files", "Invoices"]);
  });

  it("marks the current section with aria-current, and only that one (AC-4)", () => {
    render(<SectionNav />);

    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Files" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Invoices" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(<SectionNav />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});

describe("ClientSwitcher", () => {
  it("lists every row as `<Client name> · <Agency name>`, marking the current one (AC-11)", async () => {
    const user = userEvent.setup();
    render(
      <ClientSwitcher
        rows={TWO_ROWS}
        currentContactId="contact-1"
        clientName="Northwind"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Switch client/ }));

    const current = screen.getByRole("menuitem", {
      name: /Northwind · Studio North/,
    });
    expect(current).toHaveTextContent("(current)");

    const other = screen.getByRole("menuitem", {
      name: /Cinder Media · Anchor Ridge/,
    });
    expect(other).not.toHaveTextContent("(current)");
  });

  it("shows the exact refusal copy when a switch is refused (AC-11)", async () => {
    mocks.switchContact.mockResolvedValue({
      ok: false,
      error: {
        code: "not_found",
        message: "That client is no longer available to you.",
      },
    });
    const user = userEvent.setup();
    render(
      <ClientSwitcher
        rows={TWO_ROWS}
        currentContactId="contact-1"
        clientName="Northwind"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Switch client/ }));
    await user.click(screen.getByRole("menuitem", { name: /Cinder Media/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That client is no longer available to you.",
    );
  });

  it("never calls switchContact for the already current row", async () => {
    const user = userEvent.setup();
    render(
      <ClientSwitcher
        rows={TWO_ROWS}
        currentContactId="contact-1"
        clientName="Northwind"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Switch client/ }));
    await user.click(
      screen.getByRole("menuitem", { name: /Northwind · Studio North/ }),
    );

    expect(mocks.switchContact).not.toHaveBeenCalled();
  });

  it.each(THEMES)(
    "has no axe violation closed, in the %s theme",
    async (theme) => {
      const { container } = render(
        <ClientSwitcher
          rows={TWO_ROWS}
          currentContactId="contact-1"
          clientName="Northwind"
        />,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );

  it.each(THEMES)(
    "has no axe violation open, in the %s theme (the switcher is keyboard operable)",
    async (theme) => {
      const user = userEvent.setup();
      render(
        <ClientSwitcher
          rows={TWO_ROWS}
          currentContactId="contact-1"
          clientName="Northwind"
        />,
      );

      await user.click(screen.getByRole("button", { name: /Switch client/ }));

      await withTheme(theme, () =>
        expectNoAccessibilityViolations(document.body),
      );
    },
  );

  it("returns focus to the trigger on close (AC-15)", async () => {
    const user = userEvent.setup();
    render(
      <ClientSwitcher
        rows={TWO_ROWS}
        currentContactId="contact-1"
        clientName="Northwind"
      />,
    );

    const trigger = screen.getByRole("button", { name: /Switch client/ });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(trigger).toHaveFocus();
  });
});

describe("PortalEmptyState", () => {
  it("renders no action slot, since the portal never invites one (AC-5)", () => {
    render(
      <PortalEmptyState
        heading="No projects yet"
        description="Your agency has not started a project for you."
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(
      <PortalEmptyState
        heading="No projects yet"
        description="Your agency has not started a project for you."
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});

describe("OverviewSection", () => {
  it("labels the section by its own heading and links See all to its own page", () => {
    render(
      <OverviewSection id="projects" title="Projects">
        <p>content</p>
      </OverviewSection>,
    );

    const region = screen.getByRole("region", { name: "Projects" });
    expect(within(region).getByText("content")).toBeInTheDocument();
    expect(
      within(region).getByRole("link", { name: "See all" }),
    ).toHaveAttribute("href", "/portal/projects");
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(
      <OverviewSection id="projects" title="Projects">
        <p>content</p>
      </OverviewSection>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
