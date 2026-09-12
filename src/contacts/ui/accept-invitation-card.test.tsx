/**
 * covers: spec 0009 AC-9, AC-14
 *
 * The four states of the accept page, with the copy AC-9 pins, and axe in both
 * themes. `SignOutButton` needs a `ClerkProvider`, so the wrong account state
 * takes the plain control the gallery also uses.
 */
import Link from "next/link";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { ACCEPT_STATE_FIXTURES } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/contacts/accept-invitation", () => ({ acceptInvitation: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  SignOutButton: () => {
    throw new Error("SignOutButton must not mount outside ClerkProvider");
  },
}));

const { AcceptInvitationCard } = await import("./accept-invitation-card");

const signOutControl = <Link href="/sign-in">Sign out and switch account</Link>;

function stateNamed(label: string) {
  const fixture = ACCEPT_STATE_FIXTURES.find((entry) => entry.label === label);

  if (fixture === undefined) {
    throw new Error(`no fixture named ${label}`);
  }

  return fixture.state;
}

describe("the four states", () => {
  it("acceptable: names the agency, the client and the signed in address, with one button", () => {
    render(<AcceptInvitationCard state={stateNamed("acceptable")} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Accept your invitation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bright & Co has invited you to the client portal for Northwind Coffee. You are signed in as ada@northwind.example.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Accept invitation" }),
    ).toBeInTheDocument();
  });

  it("already yours: offers the portal and nothing else", () => {
    render(<AcceptInvitationCard state={stateNamed("already yours")} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "You already accepted this invitation",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to your portal" }),
    ).toBeInTheDocument();
  });

  it("wrong account: names only the signed in address and offers to switch", () => {
    render(
      <AcceptInvitationCard
        state={stateNamed("wrong account")}
        signOutControl={signOutControl}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation is for a different email address",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You are signed in as someone.else@example.com. Sign in with the address that received the invitation to accept it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign out and switch account" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/northwind/u)).toBeNull();
  });

  it("invalid: one sentence for every cause, and a way back", () => {
    render(<AcceptInvitationCard state={stateNamed("invalid")} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This invitation link is not valid",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It may have expired, been replaced by a newer one, or already been used. Ask your agency to send a new invitation.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to ClientHQ" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it.each(ACCEPT_STATE_FIXTURES.map((entry) => entry.label))(
    "has no axe violation in the %s state",
    async (label) => {
      const { container } = render(
        <main>
          <AcceptInvitationCard
            state={stateNamed(label)}
            signOutControl={signOutControl}
          />
        </main>,
      );

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    },
  );
});
