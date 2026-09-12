import type { ContactStatus } from "@/contacts/status";
import { formatBillingDate } from "@/payments/billing-state";
import { StatusChip, type ChipTint } from "@/ui/patterns/status-chip";

/**
 * The five invitation statuses as a word and a tint (spec 0009, AC-14).
 *
 * `unsent` is the one that asks for attention: a token exists but no email was
 * handed off, so it wears the warning tint and says so in words. `expired` is
 * quiet and outlined, like `void` on an invoice: over, not alarming.
 */
type Presentation = {
  readonly tint: ChipTint;
  readonly outlined?: boolean;
};

export const CONTACT_STATUS_PRESENTATION: Readonly<
  Record<ContactStatus, Presentation>
> = {
  not_invited: { tint: "neutral" },
  unsent: { tint: "warning" },
  invited: { tint: "info" },
  expired: { tint: "neutral", outlined: true },
  accepted: { tint: "success" },
};

export function contactStatusLabel(
  status: ContactStatus,
  inviteExpiresAt: Date | null,
): string {
  switch (status) {
    case "not_invited":
      return "Not invited";
    case "unsent":
      return "Email not sent";
    case "invited":
      return inviteExpiresAt === null
        ? "Invited"
        : `Invited until ${formatBillingDate(inviteExpiresAt)}`;
    case "expired":
      return "Expired";
    case "accepted":
      return "Accepted";
  }
}

export function ContactStatusChip({
  status,
  inviteExpiresAt,
}: {
  readonly status: ContactStatus;
  readonly inviteExpiresAt: Date | null;
}) {
  const { tint, outlined } = CONTACT_STATUS_PRESENTATION[status];

  return (
    <StatusChip tint={tint} outlined={outlined}>
      {contactStatusLabel(status, inviteExpiresAt)}
    </StatusChip>
  );
}
