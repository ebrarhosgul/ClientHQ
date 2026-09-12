/**
 * covers: spec 0009 AC-14
 *
 * The Contacts section in every status, empty, and archived: the badge word,
 * the inviter line and its fallback, the per status action set, and axe in
 * both themes. The Server Actions behind the controls are mocked away; they
 * have their own database suite.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { CONTACT_FIXTURES } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/contacts/add-contact", () => ({ addContact: vi.fn() }));
vi.mock("@/contacts/send-invitation", () => ({ sendInvitation: vi.fn() }));
vi.mock("@/contacts/revoke-invitation", () => ({ revokeInvitation: vi.fn() }));
vi.mock("@/contacts/update-contact", () => ({ updateContact: vi.fn() }));
vi.mock("@/contacts/remove-contact", () => ({ removeContact: vi.fn() }));

const { ContactsSectionView, invitedLine } =
  await import("./contacts-section-view");

function renderSection(
  overrides: Partial<Parameters<typeof ContactsSectionView>[0]> = {},
) {
  return render(
    <ContactsSectionView
      clientId={CONTACT_FIXTURES[0].clientId}
      clientName="Northwind Coffee"
      archived={false}
      contacts={CONTACT_FIXTURES}
      {...overrides}
    />,
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");

  if (row === null) {
    throw new Error(`${name} is not in a table row`);
  }

  return row;
}

describe("the status badge", () => {
  it.each([
    ["Ada Lovelace", "Not invited"],
    ["Grace Hopper", "Email not sent"],
    ["Katherine Johnson", "Invited until 19 September 2026 (UTC)"],
    ["Mary Jackson", "Expired"],
    ["Dorothy Vaughan", "Accepted"],
  ])("reads the status in words for %s", (name, label) => {
    renderSection();

    expect(within(rowFor(name)).getByText(label)).toBeInTheDocument();
  });
});

describe("the inviter line", () => {
  it("names the inviter and the date, falls back to the date alone, and is absent before any send", () => {
    expect(invitedLine(CONTACT_FIXTURES[2])).toBe(
      "Invited by Sam Rivera on 12 September 2026 (UTC)",
    );
    expect(invitedLine(CONTACT_FIXTURES[3])).toBe(
      "Invited on 12 August 2026 (UTC)",
    );
    expect(invitedLine(CONTACT_FIXTURES[0])).toBeUndefined();
  });
});

describe("the action set per status", () => {
  it("offers send, edit and remove before any invitation", () => {
    renderSection();
    const row = within(rowFor("Ada Lovelace"));

    expect(
      row.getByRole("button", { name: "Send invitation to Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(row.queryByRole("button", { name: /revoke/iu })).toBeNull();
    expect(
      row.getByRole("button", { name: "Edit Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(
      row.getByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();
  });

  it("offers send again, revoke, edit and remove while unsent", () => {
    renderSection();
    const row = within(rowFor("Grace Hopper"));

    expect(
      row.getByRole("button", { name: "Send again to Grace Hopper" }),
    ).toBeInTheDocument();
    expect(
      row.getByRole("button", {
        name: "Revoke the invitation to Grace Hopper",
      }),
    ).toBeInTheDocument();
  });

  it.each(["Katherine Johnson", "Mary Jackson"])(
    "offers resend and revoke for %s",
    (name) => {
      renderSection();
      const row = within(rowFor(name));

      expect(
        row.getByRole("button", { name: `Resend to ${name}` }),
      ).toBeInTheDocument();
      expect(
        row.getByRole("button", { name: `Revoke the invitation to ${name}` }),
      ).toBeInTheDocument();
    },
  );

  it("offers only edit and remove once accepted", () => {
    renderSection();
    const row = within(rowFor("Dorothy Vaughan"));

    expect(row.queryByRole("button", { name: /send|resend/iu })).toBeNull();
    expect(row.queryByRole("button", { name: /revoke/iu })).toBeNull();
    expect(
      row.getByRole("button", { name: "Edit Dorothy Vaughan" }),
    ).toBeInTheDocument();
    expect(
      row.getByRole("button", { name: "Remove Dorothy Vaughan" }),
    ).toBeInTheDocument();
  });

  it("withholds every send on an archived client and hides the add form", () => {
    renderSection({ archived: true });

    expect(screen.queryByRole("button", { name: /send|resend/iu })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByText(/This client is archived/u)).toBeInTheDocument();
  });
});

describe("the empty state and the add form", () => {
  it("describes the empty list and still offers the add form", () => {
    renderSection({ contacts: [] });

    expect(screen.getByText("No contacts yet")).toBeInTheDocument();
    expect(screen.getByText("0 contacts")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Name/u })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Email/u })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add contact" }),
    ).toBeInTheDocument();
  });

  it("names the section for a screen reader", () => {
    renderSection();

    expect(
      screen.getByRole("region", { name: "Contacts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Contacts at Northwind Coffee" }),
    ).toBeInTheDocument();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation with every status, the add form and the actions", async () => {
    const { container } = renderSection();

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation when empty", async () => {
    const { container } = renderSection({ contacts: [] });

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
