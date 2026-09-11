import type { AccessLevel } from "@/access/level";
import type {
  DeliverableStatus,
  InvoiceStatus,
  ProjectStatus,
} from "@/db/schema";
import { cn } from "@/ui/lib/cn";

/**
 * A status, shown as a word and a tint.
 *
 * The word is what carries the meaning; the tint only reinforces it (invariant
 * 4, and WCAG 1.4.1). Nobody has to tell teal from green to read an invoice,
 * and nobody printing one in black and white loses the status.
 *
 * Each tint is an explicit background and foreground token pair rather than a
 * faded solid, so both halves are declared and `contrast.test.ts` can measure
 * them (invariant 11).
 */
export const CHIP_TINTS = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
] as const;

export type ChipTint = (typeof CHIP_TINTS)[number];

const TINT_CLASSES: Readonly<Record<ChipTint, string>> = {
  neutral: "bg-chip-neutral text-chip-neutral-foreground",
  info: "bg-chip-info text-chip-info-foreground",
  success: "bg-chip-success text-chip-success-foreground",
  warning: "bg-chip-warning text-chip-warning-foreground",
  danger: "bg-chip-danger text-chip-danger-foreground",
};

/**
 * The subscription access levels, as `src/access/level.ts` defines them (spec
 * 0008). Spec 0004 drafted these four names provisionally and feature 9
 * adopted them verbatim, so the chip map is keyed by the real type.
 */
export type SubscriptionAccessLevel = AccessLevel;

type Presentation = {
  readonly label: string;
  readonly tint: ChipTint;
  /** `void` is quieter than the other neutrals, so it carries a border. */
  readonly outlined?: boolean;
};

export const INVOICE_STATUS_PRESENTATION: Readonly<
  Record<InvoiceStatus, Presentation>
> = {
  draft: { label: "Draft", tint: "neutral" },
  sent: { label: "Sent", tint: "info" },
  paid: { label: "Paid", tint: "success" },
  overdue: { label: "Overdue", tint: "danger" },
  void: { label: "Void", tint: "neutral", outlined: true },
};

export const PROJECT_STATUS_PRESENTATION: Readonly<
  Record<ProjectStatus, Presentation>
> = {
  planning: { label: "Planning", tint: "neutral" },
  in_progress: { label: "In progress", tint: "info" },
  in_review: { label: "In review", tint: "warning" },
  delivered: { label: "Delivered", tint: "success" },
};

export const DELIVERABLE_STATUS_PRESENTATION: Readonly<
  Record<DeliverableStatus, Presentation>
> = {
  pending: { label: "Pending", tint: "neutral" },
  ready: { label: "Ready", tint: "success" },
};

/** `full` shows nothing at all: good standing is not a status to display. */
export const SUBSCRIPTION_ACCESS_PRESENTATION: Readonly<
  Record<Exclude<SubscriptionAccessLevel, "full">, Presentation>
> = {
  grace: { label: "Payment overdue", tint: "warning" },
  locked: { label: "Locked", tint: "danger" },
  unsubscribed: { label: "No subscription", tint: "danger" },
};

export type StatusChipProps = {
  readonly tint: ChipTint;
  readonly outlined?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
};

export function StatusChip({
  tint,
  outlined,
  className,
  children,
}: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-tint={tint}
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TINT_CLASSES[tint],
        outlined && "border border-border",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The three chips a feature actually reaches for, each keyed by its own enum. */
export function InvoiceStatusChip({
  status,
}: {
  readonly status: InvoiceStatus;
}) {
  const { label, tint, outlined } = INVOICE_STATUS_PRESENTATION[status];

  return (
    <StatusChip tint={tint} outlined={outlined}>
      {label}
    </StatusChip>
  );
}

export function ProjectStatusChip({
  status,
}: {
  readonly status: ProjectStatus;
}) {
  const { label, tint } = PROJECT_STATUS_PRESENTATION[status];

  return <StatusChip tint={tint}>{label}</StatusChip>;
}

export function DeliverableStatusChip({
  status,
}: {
  readonly status: DeliverableStatus;
}) {
  const { label, tint } = DELIVERABLE_STATUS_PRESENTATION[status];

  return <StatusChip tint={tint}>{label}</StatusChip>;
}
