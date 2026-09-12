/**
 * covers: spec 0009 AC-14
 *
 * The five status words and tints (`StatusChip` has its own render tests):
 * this file is only about which word and tint each `ContactStatus` maps to,
 * and the one status whose word carries a date.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { contactStatusLabel, ContactStatusChip } from "./contact-status-chip";

describe("contactStatusLabel", () => {
  it("names every status in words, `invited` with its expiry date", () => {
    expect(contactStatusLabel("not_invited", null)).toBe("Not invited");
    expect(contactStatusLabel("unsent", null)).toBe("Email not sent");
    expect(contactStatusLabel("expired", null)).toBe("Expired");
    expect(contactStatusLabel("accepted", null)).toBe("Accepted");
    expect(contactStatusLabel("invited", null)).toBe("Invited");
    expect(
      contactStatusLabel("invited", new Date("2026-09-19T12:00:00.000Z")),
    ).toBe("Invited until 19 September 2026 (UTC)");
  });
});

describe("ContactStatusChip", () => {
  it("renders the word for the status it is given", () => {
    render(<ContactStatusChip status="accepted" inviteExpiresAt={null} />);

    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("renders the invited label with its expiry date", () => {
    render(
      <ContactStatusChip
        status="invited"
        inviteExpiresAt={new Date("2026-09-19T12:00:00.000Z")}
      />,
    );

    expect(
      screen.getByText("Invited until 19 September 2026 (UTC)"),
    ).toBeInTheDocument();
  });
});
