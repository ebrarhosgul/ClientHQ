/**
 * covers: spec 0008 AC-10, AC-14
 *
 * The notice `/billing` opens with when the agency is locked: a landmark, the
 * two sentences that matter (access is paused, nothing is deleted), and the
 * last one that depends on the role.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { LockedNotice } from "./locked-notice";

describe("LockedNotice", () => {
  it("is a region landmark named Access is paused", () => {
    render(<LockedNotice role="admin" />);

    expect(
      screen.getByRole("region", { name: "Access is paused" }),
    ).toBeInTheDocument();
  });

  it("says nothing has been deleted, in those words", () => {
    render(<LockedNotice role="member" />);

    expect(screen.getByRole("region")).toHaveTextContent(
      /Nothing has been deleted/,
    );
  });

  it("tells an admin that subscribing again or updating the card restores access", () => {
    render(<LockedNotice role="admin" />);

    expect(screen.getByRole("region")).toHaveTextContent(
      "Subscribing again, or updating the card, restores access straight away.",
    );
  });

  it("tells a member that only an admin can do that", () => {
    render(<LockedNotice role="member" />);

    expect(screen.getByRole("region")).toHaveTextContent(
      "Only an admin of this agency can subscribe again or update the card.",
    );
  });

  describe.each(THEMES)("in the %s theme (AC-14)", (theme) => {
    it.each(["admin", "member"] as const)(
      "has no axe violation for a %s",
      async (role) => {
        const { container } = render(<LockedNotice role={role} />);

        await withTheme(theme, () =>
          expectNoAccessibilityViolations(container),
        );
      },
    );
  });
});
