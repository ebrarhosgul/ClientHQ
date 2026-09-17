/**
 * Fixtures for the gallery and the component tests (spec 0015). Three members
 * (two admins, one member) and two pending invitations, dated so the order
 * on the page is visible.
 */
import type { OrganizationInvitation, OrganizationMember } from "@/team/rules";

export const VIEWER_CLERK_USER_ID = "user_ada";
export const FIXTURE_CLERK_ORG_ID = "org_northwind";
export const FIXTURE_AGENCY_NAME = "Northwind Studio";

export const MEMBER_FIXTURES: readonly OrganizationMember[] = [
  {
    membershipId: "orgmem_3",
    clerkUserId: "user_grace",
    name: "Grace Hopper",
    email: "grace@northwind.example",
    imageUrl: undefined,
    role: "member",
    joinedAt: new Date("2026-09-02T09:15:00Z"),
  },
  {
    membershipId: "orgmem_2",
    clerkUserId: "user_linus",
    name: "linus@northwind.example",
    email: "linus@northwind.example",
    imageUrl: undefined,
    role: "admin",
    joinedAt: new Date("2026-08-20T14:00:00Z"),
  },
  {
    membershipId: "orgmem_1",
    clerkUserId: VIEWER_CLERK_USER_ID,
    name: "Ada Lovelace",
    email: "ada@northwind.example",
    imageUrl: undefined,
    role: "admin",
    joinedAt: new Date("2026-08-01T08:00:00Z"),
  },
];

/** The viewer alone, an admin: their own controls are locked (AC-14). */
export const SOLO_ADMIN_FIXTURES: readonly OrganizationMember[] = [
  MEMBER_FIXTURES[2],
];

export const INVITATION_FIXTURES: readonly OrganizationInvitation[] = [
  {
    invitationId: "orginv_2",
    email: "alex@northwind.example",
    role: "member",
    sentAt: new Date("2026-09-16T11:30:00Z"),
  },
  {
    invitationId: "orginv_1",
    email: "sam@northwind.example",
    role: "admin",
    sentAt: new Date("2026-09-10T16:45:00Z"),
  },
];
