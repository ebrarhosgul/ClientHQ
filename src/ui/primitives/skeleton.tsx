import type { ReactNode } from "react";

import { cn } from "@/ui/lib/cn";

/**
 * A placeholder shape.
 *
 * Decorative by definition, so it is hidden from assistive technology: a screen
 * reader reading out six grey rectangles is worse than silence. What gets
 * announced is the `SkeletonRegion` around it (AC-14).
 *
 * Under `prefers-reduced-motion` the pulse stops, because the global rule in
 * `globals.css` switches every animation off. A still grey block still reads as
 * "not here yet", so nothing is lost.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * What a `Suspense` fallback should actually be.
 *
 * The convention, and the reason it is one component rather than a note in a
 * document: every skeleton fallback is wrapped in this, so the region announces
 * itself as busy once, in words, instead of the shapes inside it being read out
 * one by one.
 *
 * ```tsx
 * <Suspense fallback={<SkeletonRegion label="Loading clients"><ClientsTableSkeleton /></SkeletonRegion>}>
 *   <ClientsTable />
 * </Suspense>
 * ```
 *
 * A skeleton variant is exported beside the component it stands in for, so the
 * two cannot drift into different shapes.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-slot="skeleton-region"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("w-full", className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
