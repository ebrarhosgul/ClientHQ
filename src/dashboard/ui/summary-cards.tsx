import type { ReactNode } from "react";
import Link from "next/link";

import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * The Overview row's card frame (spec 0020 addendum, AC-16). One `<dl>`
 * grouping four `SummaryCard`s: one card per row below 640px, two from
 * 640px, four from 1024px, matching the design system's breakpoints.
 */
export function SummaryCardsGrid({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </dl>
  );
}

export type SummaryCardProps = {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  /**
   * When present, the value is a link (its accessible name is exactly the
   * value, matching a row link's rule elsewhere on the dashboard) and its hit
   * area is stretched to the whole card with CSS, while the accessible
   * boundary stays this one link.
   */
  readonly href?: string;
};

/**
 * One `<dt>`/`<dd>` pair, grouped in its own `<div>` (valid inside a `<dl>`,
 * HTML5). The card itself is `position: relative` so the link's `after`
 * pseudo element can cover it without widening what a screen reader
 * announces as the link.
 */
export function SummaryCard({ label, value, detail, href }: SummaryCardProps) {
  return (
    <div className="relative flex flex-col gap-1 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1">
        {href ? (
          <Link
            href={href}
            className="link-accent w-fit text-2xl font-semibold tabular-nums tracking-tight after:absolute after:inset-0 after:rounded-lg"
          >
            {value}
          </Link>
        ) : (
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
        )}
        {detail ? (
          <div className="text-sm text-muted-foreground">{detail}</div>
        ) : undefined}
      </dd>
    </div>
  );
}

export type SummaryCardsSkeletonProps = {
  readonly headingId: string;
  readonly heading: string;
  /** The announced loading label (AC-24), e.g. "Loading overview". */
  readonly label: string;
};

/**
 * The Overview row's own `<Suspense>` fallback: card shaped, not the list
 * shaped `DashboardSectionSkeleton` (AC-24).
 */
export function SummaryCardsSkeleton({
  headingId,
  heading,
  label,
}: SummaryCardsSkeletonProps) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-base font-semibold tracking-tight">
        {heading}
      </h2>

      <SkeletonRegion label={label}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SkeletonRegion>
    </section>
  );
}
