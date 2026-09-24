import type { ReactNode } from "react";
import Link from "next/link";

import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * The shared frame every dashboard section renders inside: heading, count
 * line, list (or empty state), footer link (spec 0020, Feature design).
 */
export type DashboardSectionProps = {
  readonly headingId: string;
  readonly heading: string;
  readonly countLine: ReactNode;
  readonly children: ReactNode;
  readonly viewAll?: { readonly href: string; readonly label: string };
};

export function DashboardSection({
  headingId,
  heading,
  countLine,
  children,
  viewAll,
}: DashboardSectionProps) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          {heading}
        </h2>
        <div className="text-sm text-muted-foreground">{countLine}</div>
      </div>

      {children}

      {viewAll ? (
        <Link
          href={viewAll.href}
          className="self-start text-sm font-medium underline underline-offset-2"
        >
          {viewAll.label}
        </Link>
      ) : undefined}
    </section>
  );
}

export type DashboardSectionSkeletonProps = {
  readonly headingId: string;
  readonly heading: string;
  /** The announced loading label (AC-10), e.g. "Loading overdue invoices". */
  readonly label: string;
};

/**
 * A section's `<Suspense>` fallback. It carries the same heading as the real
 * section (AC-15's heading order holds in every state, loading included), and
 * the placeholder rows underneath are hidden from assistive technology; only
 * `label` is announced.
 */
export function DashboardSectionSkeleton({
  headingId,
  heading,
  label,
}: DashboardSectionSkeletonProps) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2 id={headingId} className="text-base font-semibold tracking-tight">
        {heading}
      </h2>

      <SkeletonRegion label={label}>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-3/4" />
        </div>
      </SkeletonRegion>
    </section>
  );
}
