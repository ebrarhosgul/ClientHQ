import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const pathname = vi.hoisted(() => ({ current: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

// An async server component that reads a cookie. It has its own tests in
// `src/ui/patterns/theme-control.test.tsx`; here it only has to be present.
vi.mock("@/ui/patterns/theme-control", () => ({
  ThemeControl: () => <div data-testid="theme-control" />,
}));

const { AppShell } = await import("./app-shell");
const { SidebarNav } = await import("./sidebar-nav");
const { MAIN_CONTENT_ID, SkipLink } = await import("./skip-link");

describe("the skip link", () => {
  it("points at the main content", () => {
    render(<SkipLink />);

    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", `#${MAIN_CONTENT_ID}`);
  });

  it("becomes visible once it has focus", () => {
    render(<SkipLink />);

    // `sr-only` until focused, then a real control. A skip link that stays
    // invisible is one nobody knows they have.
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus-visible:not-sr-only");
  });
});

describe("the sidebar", () => {
  it("is a labelled navigation landmark", () => {
    render(<SidebarNav />);

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  it("groups the work above the agency admin", () => {
    render(<SidebarNav />);

    const links = screen.getAllByRole("link").map((link) => link.textContent);

    expect(links).toEqual([
      "Dashboard",
      "Clients",
      "Projects",
      "Invoices",
      "Team",
      "Billing",
      "Settings",
    ]);
  });

  it("puts the items in lists, so a screen reader can count them", () => {
    render(<SidebarNav />);

    expect(screen.getAllByRole("list")).toHaveLength(2);
  });

  it("marks the current section for assistive technology", () => {
    pathname.current = "/invoices";
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps the section current on a page inside it", () => {
    pathname.current = "/clients/9f2a";
    render(<SidebarNav />);

    expect(screen.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks nothing current on a path outside every section", () => {
    pathname.current = "/design";
    render(<SidebarNav />);

    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("hides its icons, which only repeat the label beside them", () => {
    pathname.current = "/dashboard";
    const { container } = render(<SidebarNav />);

    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("closes the mobile sheet when a link is followed", async () => {
    const onNavigate = vi.fn();
    render(<SidebarNav onNavigate={onNavigate} />);

    screen.getByRole("link", { name: "Clients" }).click();

    // Without this the page changes behind a sheet still covering it.
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe("the shell", () => {
  it("puts the skip link before anything else focusable", () => {
    pathname.current = "/dashboard";
    const { container } = render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    const focusable = container.querySelectorAll("a[href], button");
    expect(focusable[0]).toHaveTextContent("Skip to content");
  });

  it("renders the page inside a main landmark the skip link can reach", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", MAIN_CONTENT_ID);
    expect(within(main).getByText("Page body")).toBeInTheDocument();
  });

  it("reserves the sticky bar's height, so focus never lands under it", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    // WCAG 2.2, 2.4.11. The rule itself lives in globals.css and keys off this
    // attribute, so nothing has to remember a magic number.
    expect(screen.getByRole("main")).toHaveAttribute("data-scroll-region");
  });

  it("fills the breadcrumb slot rather than deriving a trail from the path", () => {
    render(
      <AppShell breadcrumb={<span>Northwind Coffee</span>}>
        <p>Page body</p>
      </AppShell>,
    );

    // A client id in a URL is not a label, so each feature supplies real names.
    expect(screen.getByText("Northwind Coffee")).toBeInTheDocument();
  });

  it("offers the theme control in the top bar", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    expect(screen.getByTestId("theme-control")).toBeInTheDocument();
  });

  it("shows a way in where the user menu would be, with no session", () => {
    render(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
    );

    // AC-22: signed out, the chrome keeps its shape rather than showing a gap.
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("renders with no session and no provider, because it is only chrome", () => {
    // Invariant 3: the shell runs no query, resolves no tenant and decides no
    // permission. Rendering it bare is the proof.
    expect(() =>
      render(
        <AppShell>
          <p>Page body</p>
        </AppShell>,
      ),
    ).not.toThrow();
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = render(
      <AppShell>
        <h1>Dashboard</h1>
      </AppShell>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
