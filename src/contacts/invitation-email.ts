/**
 * Composing the invitation message: subject, envelope, link, idempotency key
 * (spec 0009, AC-5). Pure, so a test can render exactly what a send would.
 */
import { createElement } from "react";

import type { EmailMessage } from "@/email/send";
import { ClientInvitationEmail } from "@/email/templates/client-invitation";
import { formatBillingDate } from "@/payments/billing-state";

export type InvitationDetails = {
  readonly contactId: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly clientName: string;
  readonly agencyName: string;
  /** The inviting staff member's address, or none if their row is gone. */
  readonly inviterEmail: string | undefined;
  readonly token: string;
  readonly digest: string;
  readonly expiresAt: Date;
  readonly baseUrl: string;
  readonly fromAddress: string;
};

/** The accept link: the app's base URL plus the token, URL encoded. */
export function acceptUrl(baseUrl: string, token: string): string {
  const url = new URL("/portal/accept", baseUrl);
  url.searchParams.set("token", token);

  return url.toString();
}

/** `client-invitation/<contact id>/<first 12 hex of the digest>`. */
export function invitationIdempotencyKey(
  contactId: string,
  digest: string,
): string {
  return `client-invitation/${contactId}/${digest.slice(0, 12)}`;
}

export function composeInvitation(details: InvitationDetails): EmailMessage {
  return {
    to: details.contactEmail,
    from: {
      address: details.fromAddress,
      name: `${details.agencyName} via ClientHQ`,
    },
    replyTo: details.inviterEmail,
    subject: `${details.agencyName} invited you to their client portal`,
    react: createElement(ClientInvitationEmail, {
      agencyName: details.agencyName,
      clientName: details.clientName,
      contactName: details.contactName,
      acceptUrl: acceptUrl(details.baseUrl, details.token),
      expiresOn: formatBillingDate(details.expiresAt),
    }),
    idempotencyKey: invitationIdempotencyKey(details.contactId, details.digest),
  };
}
