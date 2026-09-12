import Link from "next/link";

import { agencyContext } from "@/auth/context";
import { listContacts, type ContactSummary } from "@/contacts/queries";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";

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
 *
 * A failed read is contained here rather than taking the whole client page
 * down with it: the rest of the record is still worth showing, and the error
 * state offers a reload (AC-14). The failure itself still reaches the server
 * log, since it is rethrown nowhere and logged once.
 */
export async function ContactsSection({ client }: ContactsSectionProps) {
  const contacts = await loadContacts(client.id);

  if (contacts === undefined) {
    return (
      <section
        aria-labelledby="contacts-heading"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id="contacts-heading"
          className="text-base font-semibold tracking-tight"
        >
          Contacts
        </h2>
        <ErrorState
          heading="Contacts could not be loaded"
          description="The rest of this client is fine. Reload to try the contacts again."
          action={
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}`}>Reload</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <ContactsSectionView
      clientId={client.id}
      clientName={client.name}
      archived={client.archivedAt !== null}
      contacts={contacts}
    />
  );
}

async function loadContacts(
  clientId: string,
): Promise<readonly ContactSummary[] | undefined> {
  try {
    return await listContacts(await agencyContext(), clientId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "contacts.section",
        operation: "listContacts",
        outcome: "failed",
        at: new Date().toISOString(),
      }),
    );
    // A resolution failure (no session, no mirror row) is the page's to
    // handle, not this section's: let it through to the layout.
    if (error instanceof Error && error.name === "TenantResolutionError") {
      throw error;
    }

    return undefined;
  }
}
