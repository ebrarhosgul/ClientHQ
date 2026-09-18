/**
 * What product analytics hears when a membership row changes (spec 0019,
 * AC-12, AC-13), shared by the Clerk webhook and the nightly reconcile so a
 * join either of them writes is reported the same way, once, after commit.
 */
import { analytics } from "@/analytics";
import { identifyAgency, identifyPerson } from "@/analytics/agency-group";
import type { MembershipRole } from "@/db/schema";

/** What a committed membership write meant, for analytics (spec 0019). */
export type MembershipChange = {
  readonly orgId: string;
  readonly userId: string;
  readonly clerkUserId: string;
} & (
  | { readonly kind: "joined"; readonly role: MembershipRole }
  | { readonly kind: "role"; readonly role: MembershipRole }
  | { readonly kind: "removed" }
);

/**
 * After the commit, and shared with the nightly reconcile (spec 0019, AC-12,
 * AC-13): a real join is the event plus the person; every insert or removal
 * re reads the agency's `team_size`; a bare role change updates the person.
 */
export async function reportMembershipChange(
  change: MembershipChange,
): Promise<void> {
  if (change.kind === "joined") {
    analytics().track("team_member.joined", {
      distinctId: { kind: "user", clerkUserId: change.clerkUserId },
      orgId: change.orgId,
      properties: { role: change.role },
    });
  }

  if (change.kind !== "removed") {
    await identifyPerson(change);
  }

  if (change.kind !== "role") {
    await identifyAgency(change.orgId);
  }
}
