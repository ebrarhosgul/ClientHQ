import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * `/portal/projects/[id]`'s own loading state (spec 0014, AC-15): the shape
 * of the name, the status row, the detail grid and the Files section.
 */
export default function PortalProjectLoading() {
  return (
    <SkeletonRegion label="Loading the project" className="flex flex-col gap-6">
      <Skeleton className="h-6 w-48" />

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      <div className="grid gap-6 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-16" />
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
