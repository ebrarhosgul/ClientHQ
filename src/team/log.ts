/**
 * One structured line per team event (spec 0015, AC-13), in the shape
 * `src/contacts/log.ts` set: the organization id, the acting person's local
 * id, the target, the requested role where there is one, and the outcome.
 * Never an email address. The target is the invitation id for a revoke or a
 * created invitation, `none` for an invite that stopped before Clerk created
 * anything, and the membership id plus the Clerk user id otherwise.
 *
 * `console`, like the rest of the product: Vercel collects stdout.
 */
import type { MembershipRole } from "@/db/schema";

export const TEAM_OPERATIONS = [
  "invite",
  "revoke",
  "change_role",
  "remove",
] as const;

export type TeamOperation = (typeof TEAM_OPERATIONS)[number];

export type TeamLogDetails = {
  readonly operation: TeamOperation;
  /**
   * `ok`, `not_found`, `invalid`, a conflict kind (`already_member`,
   * `already_invited`, `last_admin`), or an unavailable kind
   * (`unavailable_busy`, `unavailable_read`, `unavailable_write`,
   * `mirror_failed`).
   */
  readonly outcome: string;
  readonly orgId: string;
  readonly actorUserId: string;
  readonly invitationId?: string;
  readonly membershipId?: string;
  readonly targetClerkUserId?: string;
  readonly role?: MembershipRole;
};

export type TeamLogLine = TeamLogDetails & {
  readonly event: "team.management";
  readonly level: "info" | "error";
  readonly at: string;
};

export function logTeamEvent(
  details: TeamLogDetails,
  level: "info" | "error" = "info",
): void {
  const line: TeamLogLine = {
    event: "team.management",
    level,
    ...details,
    at: new Date().toISOString(),
  };

  // One call, so one line. JSON.stringify drops the undefined fields.
  if (level === "error") {
    console.error(JSON.stringify(line));
  } else {
    console.info(JSON.stringify(line));
  }
}
