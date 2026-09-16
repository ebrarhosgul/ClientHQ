import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * `/portal/invoices/[id]`'s own loading state (spec 0014, AC-15): the shape of
 * the status line above `InvoiceDocument`, then the document itself as a
 * single skeleton card, since the frozen document has no skeleton variant of
 * its own to reuse.
 */
export default function PortalInvoiceLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>

      <SkeletonRegion label="Loading the invoice">
        <div className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-4 w-full" />
            ))}
          </div>
          <Skeleton className="h-5 w-28 self-end" />
        </div>
      </SkeletonRegion>
    </div>
  );
}
