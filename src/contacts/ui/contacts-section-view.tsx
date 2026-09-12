import { Users } from "lucide-react";
import type { ReactNode } from "react";

import type { ContactSummary } from "@/contacts/queries";
import { formatBillingDate } from "@/payments/billing-state";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";

import { AddContactForm } from "./add-contact-form";
import { ContactActions } from "./contact-actions";
import { ContactStatusChip } from "./contact-status-chip";

export type ContactsSectionViewProps = {
  readonly clientId: string;
  readonly clientName: string;
  readonly archived: boolean;
  readonly contacts: readonly ContactSummary[];
  /**
   * `/design` renders this outside any session and swaps the live controls
   * for inert ones; real pages leave both unset.
   */
  readonly addForm?: ReactNode;
  readonly actions?: (contact: ContactSummary) => ReactNode;
  /** Only `/design` sets this, because it renders the section twice on one page. */
  readonly headingId?: string;
};

/** "Invited by Ada on 12 September 2026 (UTC)", or "Invited on ..." with no inviter. */
export function invitedLine(contact: ContactSummary): string | undefined {
  if (contact.invitedAt === null) {
    return undefined;
  }

  const on = formatBillingDate(contact.invitedAt);

  return contact.invitedByName === undefined
    ? `Invited on ${on}`
    : `Invited by ${contact.invitedByName} on ${on}`;
}

const COLUMNS: readonly Column<ContactSummary>[] = [
  {
    key: "contact",
    header: "Contact",
    priority: "high",
    cellClassName: "whitespace-normal",
    cell: (contact) => (
      <div className="flex min-w-40 flex-col">
        <span className="font-medium">{contact.name}</span>
        <span className="text-xs wrap-anywhere text-muted-foreground">
          {contact.email}
        </span>
      </div>
    ),
  },
  {
    key: "status",
    header: "Status",
    priority: "high",
    cellClassName: "whitespace-normal",
    cell: (contact) => {
      const line = invitedLine(contact);

      return (
        <div className="flex flex-col items-start gap-1">
          <ContactStatusChip
            status={contact.status}
            inviteExpiresAt={contact.inviteExpiresAt}
          />
          {line ? (
            <span className="text-xs text-muted-foreground">{line}</span>
          ) : undefined}
        </div>
      );
    },
  },
];

/**
 * The Contacts section of `/clients/[id]` (spec 0009, AC-14): the list with a
 * status and the actions that status allows, an empty state, and the inline
 * add form. Presentational, so the gallery can show every status from
 * fixtures; `ContactsSection` is the server component that feeds it.
 */
export function ContactsSectionView({
  clientId,
  clientName,
  archived,
  contacts,
  addForm,
  actions,
  headingId = "contacts-heading",
}: ContactsSectionViewProps) {
  const count = contacts.length;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-base font-semibold tracking-tight">
            Contacts
          </h2>
          <p className="text-xs text-muted-foreground">
            The people at {clientName} you work with. Invite them to see their
            projects, files and invoices in the client portal.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count === 1 ? "1 contact" : `${count} contacts`}
        </p>
      </div>

      {count === 0 ? (
        <EmptyState
          heading="No contacts yet"
          description={
            archived
              ? "This client is archived, so no contacts can be added until they are restored."
              : "Add the first person you work with here, then send them an invitation to the portal."
          }
          icon={<Users />}
        />
      ) : (
        <DataTable
          caption={`Contacts at ${clientName}`}
          columns={COLUMNS}
          rows={contacts}
          rowKey={(contact) => contact.id}
          rowActions={(contact) =>
            actions ? (
              actions(contact)
            ) : (
              <ContactActions contact={contact} archived={archived} />
            )
          }
          rowActionsLabel="Actions"
        />
      )}

      {archived ? (
        count === 0 ? undefined : (
          <p className="text-xs text-muted-foreground">
            This client is archived. Restore them to add contacts or send
            invitations.
          </p>
        )
      ) : (
        <div className="border-t border-border pt-4">
          {addForm ?? <AddContactForm clientId={clientId} />}
        </div>
      )}
    </section>
  );
}
