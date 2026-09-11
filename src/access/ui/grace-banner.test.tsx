/**
 * covers: spec 0008 AC-5, AC-14
 *
 * The banner, both variants. `OpenBillingPortalButton` is stubbed (it has its
 * own tests through `billing-actions.test.tsx`); this file is about the
 * landmark, the words, the UTC date and time, who gets the button, who gets
 * the sentence, and axe in both themes.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

const mocks = vi.hoisted(() => ({
  portalButtonProps: [] as Record<string, unknown>[],
}));

vi.mock("@/payments/ui/billing-actions", () => ({
  OpenBillingPortalButton: (props: { children?: React.ReactNode }) => {
    mocks.portalButtonProps.push(props);

    return <button type="submit">{props.children}</button>;
  },
}));

const { GraceBanner } = await import("./grace-banner");

const GRACE_ENDS = new Date("2026-09-18T09:05:00.000Z");

beforeEach(() => {
  mocks.portalButtonProps.length = 0;
});

describe("GraceBanner", () => {
  it("is a region landmark named by its own first line", () => {
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="admin" />);

    expect(
      screen.getByRole("region", {
        name: "Your last payment failed, so changes are paused",
      }),
    ).toBeInTheDocument();
  });

  it("names the date and time the window closes, in UTC, and says so", () => {
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="admin" />);

    const when = screen.getByText("18 September 2026 at 09:05 (UTC)");
    expect(when.tagName).toBe("TIME");
    expect(when).toHaveAttribute("dateTime", "2026-09-18T09:05:00.000Z");
  });

  it("says reads still work, and that nothing is deleted", () => {
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="member" />);

    const region = screen.getByRole("region");
    expect(region).toHaveTextContent(/still read everything/);
    expect(region).toHaveTextContent(/Nothing is deleted/);
  });

  it("offers an admin the portal button and no link to billing", () => {
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="admin" />);

    expect(
      screen.getByRole("button", { name: "Update your card" }),
    ).toBeInTheDocument();
    expect(mocks.portalButtonProps).toHaveLength(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Only an admin/)).not.toBeInTheDocument();
  });

  it("tells a member who can fix it, links to billing, and shows no button", () => {
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="member" />);

    expect(
      screen.getByText("Only an admin of this agency can update the card."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See billing" })).toHaveAttribute(
      "href",
      "/billing",
    );
    expect(mocks.portalButtonProps).toHaveLength(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("puts the one action on the Tab order", async () => {
    const user = userEvent.setup();
    render(<GraceBanner graceEndsAt={GRACE_ENDS} role="member" />);

    await user.tab();

    expect(screen.getByRole("link", { name: "See billing" })).toHaveFocus();
  });

  describe.each(THEMES)("in the %s theme (AC-14)", (theme) => {
    it.each(["admin", "member"] as const)(
      "has no axe violation for a %s",
      async (role) => {
        const { container } = render(
          <GraceBanner graceEndsAt={GRACE_ENDS} role={role} />,
        );

        await withTheme(theme, () =>
          expectNoAccessibilityViolations(container),
        );
      },
    );
  });
});
