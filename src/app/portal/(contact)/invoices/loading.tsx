import { PageHeader } from "@/ui/patterns/page-header";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * `/portal/invoices`'s own loading state (spec 0014, AC-15): the real header,
 * then a skeleton the shape of the invoice list (a row per number, due date,
 * total and status).
 */
export default function PortalInvoicesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Every invoice your agency has issued to you, unpaid ones first."
      />

      <SkeletonRegion label="Loading invoices">
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonRegion>
    </div>
  );
}
