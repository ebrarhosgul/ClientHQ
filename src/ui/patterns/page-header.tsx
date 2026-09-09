import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";

/**
 * The title block every agency page opens with.
 *
 * One `h1` per page, so the heading outline a screen reader navigates by starts
 * where the content does. The optional description sits under it and the
 * actions sit to the right, wrapping under the title on a narrow screen rather
 * than squeezing it.
 */
export type PageHeaderProps = {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : undefined}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : undefined}
    </div>
  );
}
