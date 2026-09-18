/**
 * Tests for the entry page.
 *
 * Spec 0004 pins what this page holds (AC-17) and the two paths it links to
 * (AC-23), so unlike the placeholder it replaced, these assertions are on the
 * contract rather than only on structure. The paths in particular are load
 * bearing: feature 6 builds `/sign-in` and `/sign-up` to match them.
 *
 * `ThemeControl` is an async server component that reads a cookie, so it is
 * stubbed here and tested on its own in `src/ui/patterns/theme-control.test.tsx`.
 *
 * `Home` is itself async, for the same reason `SignInPage`'s own test stubs
 * `sessionClaims` and `redirect` (`src/app/(auth)/sign-in/[[...sign-in]]/page.test.tsx`):
 * `/` is the root `not-found.tsx`'s only way back (AC-23 of this bug's own
 * fix), and a signed in visitor who lands here must be sent onward rather
 * than shown a Sign in button for a session they already hold.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const REDIRECTED = "NEXT_REDIRECT";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  claims: { clerkUserId: undefined as string | undefined },
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirected.push(path);
    throw new Error(REDIRECTED);
  },
}));

vi.mock("@/lib/env", () => ({
  isClerkConfigured: mocks.isClerkConfigured,
}));

vi.mock("@/db/tenant/session", () => ({
  sessionClaims: async () => mocks.claims,
}));

vi.mock("@/ui/patterns/theme-control", () => ({
  ThemeControl: () => <div data-testid="theme-control" />,
}));

const { default: Home, metadata } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirected.length = 0;
  mocks.isClerkConfigured.mockReturnValue(false);
  mocks.claims = { clerkUserId: undefined };
});

describe("Home page", () => {
  it("names the product in its browser title", () => {
    expect(metadata.title).toBe("ClientHQ");
  });

  it("puts its content in a main landmark, so screen readers can skip to it", async () => {
    render(await Home());

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("has exactly one first level heading", async () => {
    render(await Home());

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("names the product in that heading", async () => {
    render(await Home());

    expect(
      screen.getByRole("heading", { level: 1, name: "ClientHQ" }),
    ).toBeInTheDocument();
  });

  it("skips no heading level between the first and the next", async () => {
    render(await Home());

    const levels = screen
      .getAllByRole("heading")
      .map((heading) => Number(heading.tagName.slice(1)))
      .sort((a, b) => a - b);

    // Jumping h1 to h3 breaks the outline screen reader users navigate by.
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it("says in one line what the product is", async () => {
    render(await Home());

    expect(
      within(screen.getByRole("main")).getByText(/agency runs its clients/i),
    ).toBeInTheDocument();
  });

  it("offers Sign in as the primary action", async () => {
    render(await Home());

    const signIn = screen.getByRole("link", { name: "Sign in" });

    expect(signIn).toHaveAttribute("href", "/sign-in");
    expect(signIn).toHaveAttribute("data-variant", "default");
  });

  it("offers Create an agency as the secondary action", async () => {
    render(await Home());

    const signUp = screen.getByRole("link", { name: "Create an agency" });

    expect(signUp).toHaveAttribute("href", "/sign-up");
    // Secondary, so the two are not competing for the same weight.
    expect(signUp).toHaveAttribute("data-variant", "outline");
  });

  it("uses the exact paths feature 6 has to build", async () => {
    // AC-23 fixes these here so that feature has nothing to choose. Changing
    // either one is a change to the spec, not to this page.
    render(await Home());

    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/sign-in", "/sign-up"]);
  });

  it("offers the theme control", async () => {
    render(await Home());

    expect(screen.getByTestId("theme-control")).toBeInTheDocument();
  });

  it("renders without a client side hook, so it stays a server component", async () => {
    // A `use client` directive or a hook here would pull the entry page into the
    // browser bundle for no reason. Rendering with no provider proves neither.
    await expect(Home().then(render)).resolves.not.toThrow();
  });

  it("shows the Sign in gate when Clerk is not configured", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    render(await Home());

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows the Sign in gate for a signed out visitor", async () => {
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.claims = { clerkUserId: undefined };

    render(await Home());

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends a signed in visitor onward instead of showing Sign in again", async () => {
    // The root not-found page's only way back is "/" (AC-23), so someone
    // already holding a session must not land on a Sign in button here:
    // that is what forced a signed in portal contact through Clerk's real
    // sign in form again after a 404.
    mocks.isClerkConfigured.mockReturnValue(true);
    mocks.claims = { clerkUserId: "user_1" };

    await expect(Home()).rejects.toThrow(REDIRECTED);
    expect(mocks.redirected).toEqual(["/onboarding"]);
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = render(await Home());

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
