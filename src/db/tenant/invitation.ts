/**
 * The acceptance door: reading and binding a `client_contacts` row by
 * invitation token, with no tenant context (spec 0009, AC-9 to AC-11, AC-13).
 *
 * The person on this path is signed in with Clerk but belongs to no
 * organization yet, so nothing in `context.ts` can resolve them. Rather than
 * open `withSystemAccess` for it, this file offers exactly two named functions
 * that take a parsed token and nothing else: the row they fetch by primary key
 * is what names the organization. The caller never supplies one, and the
 * organization on the row is where the log line's id comes from.
 *
 * Proof of identity is Clerk's email verification, never the link. Every check
 * runs in the same order in both functions, and the page's four states are
 * derived from `inspectInvitation` alone so nothing is decided twice.
 *
 * It sits inside `src/db/tenant/`, the one directory `clienthq/no-raw-db-import`
 * exempts, and is the third named exit alongside `unsafeTenantQuery` and
 * `withSystemAccess`.
 */
import { and, eq, gt, isNull } from "drizzle-orm";

import { clientContacts, clients, organizations, users } from "../schema";
import { digestsMatch, hashToken, type ParsedToken } from "@/contacts/token";
import { pooledDb, type Executor } from "./executor";
import { ensureUserRow, type MirrorUser } from "./provisioning";

/** Who is asking: the Clerk user and every verified address on the account. */
export type InvitationIdentity = {
  readonly token: ParsedToken;
  readonly clerkUserId: string;
  /** Already lowercased, from `clerkVerifiedEmails()`. */
  readonly verifiedEmails: readonly string[];
};

export type InspectOutcome =
  | {
      readonly kind: "acceptable";
      readonly contactId: string;
      readonly orgId: string;
      readonly clientName: string;
      readonly agencyName: string;
      readonly contactEmail: string;
    }
  | {
      readonly kind: "already_yours";
      readonly contactId: string;
      readonly orgId: string;
    }
  | {
      readonly kind: "wrong_account";
      readonly contactId: string;
      readonly orgId: string;
    }
  | {
      readonly kind: "invalid";
      readonly contactId?: string;
      readonly orgId?: string;
    };

export type AcceptOutcome =
  | {
      readonly kind: "accepted" | "already_yours";
      readonly contactId: string;
      readonly orgId: string;
    }
  | {
      readonly kind: "refused";
      readonly contactId?: string;
      readonly orgId?: string;
    };

/** The row and its two parents, as both functions read them. */
async function fetchRow(executor: Executor, contactId: string) {
  const [row] = await executor
    .select({
      id: clientContacts.id,
      orgId: clientContacts.orgId,
      email: clientContacts.email,
      userId: clientContacts.userId,
      inviteTokenHash: clientContacts.inviteTokenHash,
      inviteExpiresAt: clientContacts.inviteExpiresAt,
      clientName: clients.name,
      clientArchivedAt: clients.archivedAt,
      agencyName: organizations.name,
      loginClerkUserId: users.clerkUserId,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clients.id, clientContacts.clientId))
    .innerJoin(organizations, eq(organizations.id, clientContacts.orgId))
    .leftJoin(users, eq(users.id, clientContacts.userId))
    .where(eq(clientContacts.id, contactId))
    .limit(1);

  return row;
}

type FetchedRow = NonNullable<Awaited<ReturnType<typeof fetchRow>>>;

/**
 * The checks every acceptance passes, in the spec's order: digest, expiry,
 * binding, archived client, verified email. Returns the page state the row is
 * in for this person, without writing.
 */
function classify(
  row: FetchedRow | undefined,
  identity: InvitationIdentity,
  now: Date,
): InspectOutcome {
  if (row === undefined) {
    return { kind: "invalid" };
  }

  const ids = { contactId: row.id, orgId: row.orgId };

  if (row.inviteTokenHash === null && row.userId === null) {
    return { kind: "invalid", ...ids };
  }

  // A bound row has no digest (acceptance clears it), so the hash check is
  // only meaningful while the row is unbound. Once bound, the outcome depends
  // on who is asking: the accepter sees "already yours", anyone else sees
  // nothing.
  if (row.userId !== null) {
    return row.loginClerkUserId === identity.clerkUserId
      ? { kind: "already_yours", ...ids }
      : { kind: "invalid", ...ids };
  }

  if (
    row.inviteTokenHash === null ||
    !digestsMatch(row.inviteTokenHash, hashToken(identity.token.token))
  ) {
    return { kind: "invalid", ...ids };
  }

  if (row.inviteExpiresAt === null || row.inviteExpiresAt <= now) {
    return { kind: "invalid", ...ids };
  }

  if (row.clientArchivedAt !== null) {
    return { kind: "invalid", ...ids };
  }

  if (!identity.verifiedEmails.includes(row.email)) {
    return { kind: "wrong_account", ...ids };
  }

  return {
    kind: "acceptable",
    ...ids,
    clientName: row.clientName,
    agencyName: row.agencyName,
    contactEmail: row.email,
  };
}

/** What `/portal/accept` should show this person. Never writes. */
export async function inspectInvitation(
  identity: InvitationIdentity,
  executor?: Executor,
  now: Date = new Date(),
): Promise<InspectOutcome> {
  const db = executor ?? (await pooledDb());
  const row = await fetchRow(db, identity.token.contactId);

  return classify(row, identity, now);
}

/**
 * Bind the row to this person, once.
 *
 * Re runs every check, then in one transaction makes sure the `users` mirror
 * row exists and updates the contact with `user_id is null` in the `where`, so
 * two concurrent accepts of one link produce exactly one binding: the loser's
 * update matches nothing, and a second read tells it whether the winner was
 * the same person (`already_yours`) or not (`refused`).
 */
export async function acceptInvitation(
  identity: InvitationIdentity,
  mirrorUser: MirrorUser,
  executor?: Executor,
  now: Date = new Date(),
): Promise<AcceptOutcome> {
  const db = executor ?? (await pooledDb());
  const first = classify(
    await fetchRow(db, identity.token.contactId),
    identity,
    now,
  );

  if (first.kind === "already_yours") {
    return first;
  }

  if (first.kind !== "acceptable") {
    return { kind: "refused", contactId: first.contactId, orgId: first.orgId };
  }

  const digest = hashToken(identity.token.token);

  const bound = await db.transaction(async (tx) => {
    const { userId } = await ensureUserRow(mirrorUser, tx);

    const [row] = await tx
      .update(clientContacts)
      .set({
        userId,
        acceptedAt: now,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      })
      .where(
        and(
          eq(clientContacts.id, first.contactId),
          isNull(clientContacts.userId),
          eq(clientContacts.inviteTokenHash, digest),
          gt(clientContacts.inviteExpiresAt, now),
        ),
      )
      .returning({ id: clientContacts.id });

    return row !== undefined;
  });

  if (bound) {
    return { kind: "accepted", contactId: first.contactId, orgId: first.orgId };
  }

  // Someone got there first. Read again to find out who.
  const second = classify(
    await fetchRow(db, identity.token.contactId),
    identity,
    now,
  );

  return second.kind === "already_yours"
    ? second
    : { kind: "refused", contactId: first.contactId, orgId: first.orgId };
}
