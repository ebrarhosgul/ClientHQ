import { formatBillingDate } from "@/payments/billing-state";
import { roleLabel, type OrganizationInvitation } from "@/team/rules";
import { DataTable, type Column } from "@/ui/patterns/data-table";

import { RevokeInvitationButton } from "./revoke-invitation-button";

export type PendingInvitationsTableProps = {
  readonly invitations: readonly OrganizationInvitation[];
  readonly agencyName: string;
  readonly headingId?: string;
};

const COLUMNS: readonly Column<OrganizationInvitation>[] = [
  {
    key: "email",
    header: "Email",
    priority: "high",
    cellClassName: "whitespace-normal wrap-anywhere",
    cell: (invitation) => invitation.email,
  },
  {
    key: "role",
    header: "Role",
    priority: "high",
    cell: (invitation) => roleLabel(invitation.role),
  },
  {
    key: "sent",
    header: "Sent",
    priority: "low",
    cell: (invitation) => (
      <time dateTime={invitation.sentAt.toISOString()} className="tabular-nums">
        {formatBillingDate(invitation.sentAt)}
      </time>
    ),
  },
];

export const NO_PENDING_INVITATIONS = "No pending invitations.";

/**
 * The Pending invitations section of `/team`, admins only (spec 0015, AC-1,
 * AC-4). There is no resend: revoke, then invite again.
 */
export function PendingInvitationsTable({
  invitations,
  agencyName,
  headingId = "pending-heading",
}: PendingInvitationsTableProps) {
  const count = invitations.length;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-base font-semibold tracking-tight">
            Pending invitations
          </h2>
          <p className="text-xs text-muted-foreground">
            Sent but not yet accepted. To send a fresh link, revoke the old one
            and invite the address again.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count === 1 ? "1 pending" : `${count} pending`}
        </p>
      </div>

      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_PENDING_INVITATIONS}
        </p>
      ) : (
        <DataTable
          caption={`Pending invitations to ${agencyName}`}
          columns={COLUMNS}
          rows={invitations}
          rowKey={(invitation) => invitation.invitationId}
          rowActions={(invitation) => (
            <RevokeInvitationButton
              invitationId={invitation.invitationId}
              email={invitation.email}
            />
          )}
          rowActionsLabel="Actions"
        />
      )}
    </section>
  );
}
