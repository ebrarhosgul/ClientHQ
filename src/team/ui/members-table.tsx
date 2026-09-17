import { Users } from "lucide-react";

import type { MembershipRole } from "@/db/schema";
import { formatBillingDate } from "@/payments/billing-state";
import { adminCount, roleLabel, type OrganizationMember } from "@/team/rules";
import { DataTable, type Column } from "@/ui/patterns/data-table";
import { EmptyState } from "@/ui/patterns/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/primitives/avatar";
import { Badge } from "@/ui/primitives/badge";

import { MemberRoleSelect } from "./member-role-select";
import { RemoveMemberButton } from "./remove-member-button";

export type MembersTableProps = {
  readonly members: readonly OrganizationMember[];
  readonly agencyName: string;
  readonly clerkOrgId: string;
  readonly viewerClerkUserId: string;
  readonly viewerRole: MembershipRole;
  readonly headingId?: string;
};

function initials(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part !== "");
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase() || "?";
}

function personCell(member: OrganizationMember, self: boolean) {
  return (
    <div className="flex min-w-40 items-center gap-3">
      <Avatar size="sm">
        {member.imageUrl ? (
          <AvatarImage src={member.imageUrl} alt="" />
        ) : undefined}
        <AvatarFallback>{initials(member.name)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col">
        <span className="flex items-center gap-2 font-medium">
          {member.name}
          {self ? <Badge variant="secondary">You</Badge> : undefined}
        </span>
        {member.name !== member.email ? (
          <span className="text-xs wrap-anywhere text-muted-foreground">
            {member.email}
          </span>
        ) : undefined}
      </div>
    </div>
  );
}

/**
 * The Members section of `/team` (spec 0015, AC-1, AC-14). An admin gets the
 * role select and the remove button on every row; a member sees the role as
 * text and no controls. The acting person's own row carries the `You` badge,
 * and when they are the only admin their controls are locked with the
 * reason as visible text.
 */
export function MembersTable({
  members,
  agencyName,
  clerkOrgId,
  viewerClerkUserId,
  viewerRole,
  headingId = "members-heading",
}: MembersTableProps) {
  const admins = adminCount(members);
  const canManage = viewerRole === "admin";
  const count = members.length;

  const columns: readonly Column<OrganizationMember>[] = [
    {
      key: "person",
      header: "Person",
      priority: "high",
      cellClassName: "whitespace-normal",
      cell: (member) =>
        personCell(member, member.clerkUserId === viewerClerkUserId),
    },
    {
      key: "role",
      header: "Role",
      priority: "high",
      cellClassName: "whitespace-normal align-top",
      cell: (member) => {
        const self = member.clerkUserId === viewerClerkUserId;

        return canManage ? (
          <MemberRoleSelect
            membershipId={member.membershipId}
            memberName={member.name}
            role={member.role}
            self={self}
            clerkOrgId={clerkOrgId}
            lockedAsLastAdmin={self && member.role === "admin" && admins === 1}
          />
        ) : (
          roleLabel(member.role)
        );
      },
    },
    {
      key: "joined",
      header: "Joined",
      priority: "low",
      cell: (member) => (
        <time dateTime={member.joinedAt.toISOString()} className="tabular-nums">
          {formatBillingDate(member.joinedAt)}
        </time>
      ),
    },
  ];

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-base font-semibold tracking-tight">
            Members
          </h2>
          <p className="text-xs text-muted-foreground">
            Everyone who works in {agencyName}, read from your sign in provider
            as it is right now.
          </p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count === 1 ? "1 member" : `${count} members`}
          {admins === 1 ? ", 1 admin" : `, ${admins} admins`}
        </p>
      </div>

      {count === 0 ? (
        <EmptyState
          icon={<Users />}
          heading="No members yet"
          description="Invite the first person and they appear here once they accept."
        />
      ) : (
        <DataTable
          caption={`Members of ${agencyName}`}
          columns={columns}
          rows={members}
          rowKey={(member) => member.membershipId}
          rowActions={
            canManage
              ? (member) => {
                  const self = member.clerkUserId === viewerClerkUserId;

                  return (
                    <RemoveMemberButton
                      membershipId={member.membershipId}
                      memberName={member.name}
                      agencyName={agencyName}
                      self={self}
                      lockedAsLastAdmin={
                        self && member.role === "admin" && admins === 1
                      }
                    />
                  );
                }
              : undefined
          }
          rowActionsLabel="Actions"
        />
      )}
    </section>
  );
}
