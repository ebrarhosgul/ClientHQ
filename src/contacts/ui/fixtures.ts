/**
 * Fixtures for `/design` and the component tests: one contact per status,
 * plus the four accept page states (spec 0009, AC-14). No database, no
 * session.
 */
import type { ContactSummary } from "@/contacts/queries";

import type { AcceptInvitationState } from "./accept-invitation-card";

const NOW = new Date("2026-09-12T10:00:00.000Z");
const IN_A_WEEK = new Date("2026-09-19T10:00:00.000Z");
const LAST_WEEK = new Date("2026-09-05T10:00:00.000Z");
const A_MONTH_AGO = new Date("2026-08-12T10:00:00.000Z");

export const CONTACT_FIXTURES: readonly ContactSummary[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    clientId: "00000000-0000-4000-8000-0000000000c1",
    name: "Ada Lovelace",
    email: "ada@northwind.example",
    status: "not_invited",
    inviteExpiresAt: null,
    invitedAt: null,
    invitedByName: undefined,
    acceptedAt: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    clientId: "00000000-0000-4000-8000-0000000000c1",
    name: "Grace Hopper",
    email: "grace@northwind.example",
    status: "unsent",
    inviteExpiresAt: IN_A_WEEK,
    invitedAt: null,
    invitedByName: undefined,
    acceptedAt: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    clientId: "00000000-0000-4000-8000-0000000000c1",
    name: "Katherine Johnson",
    email: "katherine@northwind.example",
    status: "invited",
    inviteExpiresAt: IN_A_WEEK,
    invitedAt: NOW,
    invitedByName: "Sam Rivera",
    acceptedAt: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    clientId: "00000000-0000-4000-8000-0000000000c1",
    name: "Mary Jackson",
    email: "mary@northwind.example",
    status: "expired",
    inviteExpiresAt: LAST_WEEK,
    invitedAt: A_MONTH_AGO,
    invitedByName: undefined,
    acceptedAt: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    clientId: "00000000-0000-4000-8000-0000000000c1",
    name: "Dorothy Vaughan",
    email: "dorothy@northwind.example",
    status: "accepted",
    inviteExpiresAt: null,
    invitedAt: A_MONTH_AGO,
    invitedByName: "Sam Rivera",
    acceptedAt: LAST_WEEK,
  },
];

export const ACCEPT_STATE_FIXTURES: readonly {
  readonly label: string;
  readonly state: AcceptInvitationState;
}[] = [
  {
    label: "acceptable",
    state: {
      kind: "acceptable",
      token: "fixture.token",
      agencyName: "Bright & Co",
      clientName: "Northwind Coffee",
      signedInEmail: "ada@northwind.example",
    },
  },
  {
    label: "already yours",
    state: { kind: "already_yours", token: "fixture.token" },
  },
  {
    label: "wrong account",
    state: {
      kind: "wrong_account",
      signedInEmail: "someone.else@example.com",
      switchAccountUrl: "/sign-in",
    },
  },
  { label: "invalid", state: { kind: "invalid" } },
];
