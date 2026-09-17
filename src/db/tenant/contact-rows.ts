/**
 * The switcher's own read: every accepted `client_contacts` row a person
 * holds, across clients and across agencies (spec 0014, AC-11).
 *
 * A second read of `client_contacts` with no tenant predicate, alongside
 * `resolveContactContext` in `context.ts`; the two are the only places this
 * table is read across organizations. It takes the mirror row's id
 * (`ctx.userId`, already resolved by the caller), so it needs no join to
 * `users` and no session read of its own, unlike `invitation.ts`'s door,
 * which has no context to be handed at all yet.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";

import { clientContacts, clients, organizations } from "../schema";
import { pooledDb, type Executor } from "./executor";

export type AcceptedContactRow = {
  readonly contactId: string;
  readonly clientId: string;
  readonly orgId: string;
  readonly clientName: string;
  readonly agencyName: string;
};

/**
 * Every row this person has accepted, ordered by client name then agency
 * name then id for a stable, deterministic menu.
 */
export async function listAcceptedContactRows(
  userId: string,
  executor?: Executor,
): Promise<readonly AcceptedContactRow[]> {
  const db = executor ?? (await pooledDb());

  return db
    .select({
      contactId: clientContacts.id,
      clientId: clientContacts.clientId,
      orgId: clientContacts.orgId,
      clientName: clients.name,
      agencyName: organizations.name,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clients.id, clientContacts.clientId))
    .innerJoin(organizations, eq(organizations.id, clientContacts.orgId))
    .where(
      and(
        eq(clientContacts.userId, userId),
        isNotNull(clientContacts.acceptedAt),
      ),
    )
    .orderBy(
      asc(clients.name),
      asc(organizations.name),
      asc(clientContacts.id),
    );
}
