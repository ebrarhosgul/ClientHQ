import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";

/**
 * The one empty state. Heading, one line of explanation, and the primary action
 * where there is one.
 *
 * It ships no copy of its own. Every caller supplies its own words, because
 * "No clients yet" and "No invoices match this filter" are different situations
 * and a shared sentence would be wrong for both.
 *
 * The client portal is read only, so its empty states describe rather than
 * invite: "No invoices yet", never "Create an invoice". That is a rule for
 * callers, which is why `action` is optional and nothing here supplies one.
 */
export type EmptyStateProps = {
  readonly heading: string;
  readonly description: string;
  readonly icon?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
};

export function EmptyState({
  heading,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border border-dashed bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="text-muted-foreground [&_svg]:size-6">
          {icon}
        </span>
      ) : undefined}

      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-card-foreground">
          {heading}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      {action ? <div className="mt-1">{action}</div> : undefined}
    </div>
  );
}
