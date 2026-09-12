/**
 * A contact's invitation status, derived and never stored (spec 0009, "State
 * transitions").
 *
 * One function, one order of checks. `accepted` wins because a bound login is
 * the only fact that outranks everything else; `unsent` is a token with no
 * delivery behind it, which is what a provider failure or a crash between the
 * two writes of a send leaves behind; the rest read the hash and the clock.
 */

export const CONTACT_STATUSES = [
  "not_invited",
  "unsent",
  "invited",
  "expired",
  "accepted",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

/** The columns the derivation reads. A full row satisfies this. */
export type ContactStatusRow = {
  readonly userId: string | null;
  readonly inviteTokenHash: string | null;
  readonly inviteExpiresAt: Date | null;
  readonly invitedAt: Date | null;
};

export function contactStatus(row: ContactStatusRow, now: Date): ContactStatus {
  if (row.userId !== null) {
    return "accepted";
  }

  if (row.inviteTokenHash === null) {
    return "not_invited";
  }

  if (row.invitedAt === null) {
    return "unsent";
  }

  if (row.inviteExpiresAt !== null && row.inviteExpiresAt > now) {
    return "invited";
  }

  return "expired";
}

/** What staff may do to a contact in each status. */
export type ContactAction = "send" | "resend" | "revoke" | "edit" | "remove";

/**
 * The action set per status. `edit` on an accepted contact means the name
 * only; the action itself refuses an email change (AC-2).
 */
export function contactActions(
  status: ContactStatus,
): readonly ContactAction[] {
  switch (status) {
    case "not_invited":
      return ["send", "edit", "remove"];
    case "unsent":
    case "invited":
    case "expired":
      return ["resend", "revoke", "edit", "remove"];
    case "accepted":
      return ["edit", "remove"];
  }
}
