import { agencyContext } from "@/auth/context";
import { listContacts } from "@/contacts/queries";

import { ContactsSectionView } from "./contacts-section-view";

export type ContactsSectionProps = {
  readonly client: {
    readonly id: string;
    readonly name: string;
    readonly archivedAt: Date | null;
  };
};

/**
 * The Contacts section, fed from the scoped read (spec 0009, AC-13, AC-14).
 *
 * `agencyContext()` is cached per request, so this costs the page one query
 * for the contacts and nothing for the context it already resolved.
 */
export async function ContactsSection({ client }: ContactsSectionProps) {
  const contacts = await listContacts(await agencyContext(), client.id);

  return (
    <ContactsSectionView
      clientId={client.id}
      clientName={client.name}
      archived={client.archivedAt !== null}
      contacts={contacts}
    />
  );
}
