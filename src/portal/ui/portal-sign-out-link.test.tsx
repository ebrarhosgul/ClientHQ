/**
 * covers: spec 0014 AC-3
 *
 * `/portal/unavailable`'s own way out: a real sign out, not a link that
 * leaves the session open, styled as a link, with an axe check in both
 * themes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: mocks.signOut }),
}));

const { PortalSignOutLink } = await import("./portal-sign-out-link");

describe("PortalSignOutLink", () => {
  it("signs out to / when clicked, rather than only linking to /sign-in", async () => {
    render(<PortalSignOutLink />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
  });

  it.each(THEMES)("has no axe violation, in the %s theme", async (theme) => {
    const { container } = render(<PortalSignOutLink />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
