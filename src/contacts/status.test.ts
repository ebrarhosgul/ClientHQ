/**
 * covers: spec 0009 AC-6, AC-14 ("State transitions")
 */
import { describe, expect, it } from "vitest";

import { contactActions, contactStatus, type ContactStatusRow } from "./status";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const FUTURE = new Date("2026-09-19T12:00:00.000Z");
const PAST = new Date("2026-09-01T12:00:00.000Z");

function row(overrides: Partial<ContactStatusRow>): ContactStatusRow {
  return {
    userId: null,
    inviteTokenHash: null,
    inviteExpiresAt: null,
    invitedAt: null,
    ...overrides,
  };
}

describe("contactStatus", () => {
  it("is not invited with no hash", () => {
    expect(contactStatus(row({}), NOW)).toBe("not_invited");
    // History from a revoked or edited invitation does not make it invited.
    expect(contactStatus(row({ invitedAt: PAST }), NOW)).toBe("not_invited");
  });

  it("is unsent when a hash exists but no email was ever handed off", () => {
    expect(
      contactStatus(
        row({ inviteTokenHash: "h", inviteExpiresAt: FUTURE, invitedAt: null }),
        NOW,
      ),
    ).toBe("unsent");
  });

  it("is invited while the link is live and a send succeeded", () => {
    expect(
      contactStatus(
        row({ inviteTokenHash: "h", inviteExpiresAt: FUTURE, invitedAt: PAST }),
        NOW,
      ),
    ).toBe("invited");
  });

  it("is expired once the expiry has passed", () => {
    expect(
      contactStatus(
        row({ inviteTokenHash: "h", inviteExpiresAt: PAST, invitedAt: PAST }),
        NOW,
      ),
    ).toBe("expired");
    // Expiring exactly now is expired: "after now" is the live condition.
    expect(
      contactStatus(
        row({ inviteTokenHash: "h", inviteExpiresAt: NOW, invitedAt: PAST }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("is accepted whenever a user is bound, whatever else the row holds", () => {
    expect(contactStatus(row({ userId: "u" }), NOW)).toBe("accepted");
    expect(
      contactStatus(
        row({ userId: "u", inviteTokenHash: "h", inviteExpiresAt: FUTURE }),
        NOW,
      ),
    ).toBe("accepted");
  });
});

describe("contactActions", () => {
  it("offers send, edit and remove before any invitation", () => {
    expect(contactActions("not_invited")).toEqual(["send", "edit", "remove"]);
  });

  it.each(["unsent", "invited", "expired"] as const)(
    "offers resend, revoke, edit and remove when %s",
    (status) => {
      expect(contactActions(status)).toEqual([
        "resend",
        "revoke",
        "edit",
        "remove",
      ]);
    },
  );

  it("offers only edit and remove once accepted", () => {
    expect(contactActions("accepted")).toEqual(["edit", "remove"]);
  });
});
