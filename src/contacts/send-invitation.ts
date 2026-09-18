"use server";

/**
 * Sending, and resending, a portal invitation (spec 0009, AC-3 to AC-6).
 *
 * Two writes and a network call, deliberately not in one transaction: the pool
 * is capped at one connection (spec 0001), and holding it across a call to the
 * email provider would stall every other request. So the order is the
 * contract instead. First the digest, expiry and inviter are written, which is
 * what makes the new link the only live one; then the email goes out; and only
 * once the provider has accepted it is `invited_at` stamped. A failure between
 * the two writes leaves a row whose status reads `unsent`, never one that
 * claims an email was delivered.
 *
 * The token exists in three places for a moment: this handler's stack, the
 * outgoing email, and the person's inbox. It is not in the row, not in a log
 * line, and not in the returned data.
 */
import { eq, gt } from "drizzle-orm";

import { clientContacts, memberships } from "@/db/schema";
import {
  agencyProfile,
  tenantActionError,
  withTenantAction,
} from "@/db/tenant";
import { sendEmail } from "@/email/send";
import { env } from "@/lib/env";

import { composeInvitation } from "./invitation-email";
import {
  DAILY_CAP,
  DAILY_WINDOW_MS,
  cooldownRefuses,
  dailyCapRefuses,
  inviteExpiry,
} from "./limits";
import { logContactEvent } from "./log";
import { contactIdInput } from "./schema";
import { generateToken, hashToken } from "./token";

export type SentInvitation = {
  readonly id: string;
  readonly clientId: string;
  readonly expiresAt: Date;
};

const RATE_LIMITED = {
  code: "rate_limited",
  message: "",
} as const;

export const sendInvitation = withTenantAction({
  name: "sendInvitation",
  input: contactIdInput,
  revalidate: { paths: [{ path: "/clients/[id]", type: "page" }] },
  handler: async ({ input, ctx, db }): Promise<SentInvitation> => {
    const contact = await db.findFirst(clientContacts, {
      where: eq(clientContacts.id, input.contactId),
      with: { client: { columns: { name: true, archivedAt: true } } },
    });

    if (contact === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (contact.userId !== null) {
      throw tenantActionError({
        code: "conflict",
        message: "This contact has already accepted an invitation.",
      });
    }

    if (contact.client.archivedAt !== null) {
      throw tenantActionError({
        code: "conflict",
        message: "This client is archived. Restore them to send invitations.",
      });
    }

    const now = new Date();

    if (cooldownRefuses(contact.invitedAt, now)) {
      throw tenantActionError({
        ...RATE_LIMITED,
        message:
          "An invitation went to this contact less than five minutes ago. Wait a few minutes before sending another.",
      });
    }

    const recent = await db.findMany(clientContacts, {
      where: gt(
        clientContacts.invitedAt,
        new Date(now.getTime() - DAILY_WINDOW_MS),
      ),
      limit: DAILY_CAP,
    });

    if (
      dailyCapRefuses(
        recent.flatMap((row) => row.invitedAt ?? []),
        now,
      )
    ) {
      throw tenantActionError({
        ...RATE_LIMITED,
        message:
          "Your agency has sent its daily allowance of invitations. Try again tomorrow.",
      });
    }

    // From here the previous link, if any, is dead: the digest is replaced
    // before the email is even composed.
    const token = generateToken(contact.id);
    const digest = hashToken(token);
    const expiresAt = inviteExpiry(now);

    const updated = await db.update(clientContacts, contact.id, {
      inviteTokenHash: digest,
      inviteExpiresAt: expiresAt,
      invitedByUserId: ctx.userId,
    });

    if (updated === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const [agency, membership] = await Promise.all([
      agencyProfile(ctx),
      db.findFirst(memberships, {
        where: eq(memberships.userId, ctx.userId),
        with: { user: { columns: { email: true } } },
      }),
    ]);

    if (agency === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    const sent = await sendEmail(
      composeInvitation({
        contactId: contact.id,
        contactName: contact.name,
        contactEmail: contact.email,
        clientName: contact.client.name,
        agencyName: agency.name,
        inviterEmail: membership?.user.email,
        token,
        digest,
        expiresAt,
        baseUrl: env().NEXT_PUBLIC_APP_URL,
        fromAddress: env().EMAIL_FROM,
      }),
    );

    if (!sent.ok) {
      logContactEvent({
        operation: "send_failed",
        outcome: "provider_refused",
        orgId: ctx.orgId,
        contactId: contact.id,
      });

      throw tenantActionError({
        code: "unavailable",
        message:
          "The invitation email could not be sent. Nothing else changed; try sending it again.",
      });
    }

    await db.update(clientContacts, contact.id, { invitedAt: new Date() });

    logContactEvent({
      operation: "send",
      outcome: contact.inviteTokenHash === null ? "sent" : "resent",
      orgId: ctx.orgId,
      contactId: contact.id,
    });

    return { id: contact.id, clientId: contact.clientId, expiresAt };
  },
  track: {
    event: "contact.invited",
    properties: (_input, sent) => ({ client_id: sent.clientId }),
  },
});
