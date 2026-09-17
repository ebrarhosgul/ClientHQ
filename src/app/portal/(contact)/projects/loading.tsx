import { PageHeader } from "@/ui/patterns/page-header";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * `/portal/projects`'s own loading state (spec 0014, AC-15): the real header,
 * then a skeleton the shape of the `DataTable` it loads into (a row per name,
 * status and due date).
 */
export default function PortalProjectsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Every project your agency is running for you, in every stage."
      />

      <SkeletonRegion label="Loading projects">
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {[0, 1, 2, 3, 4].map((row) => (
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
      </SkeletonRegion>
    </div>
  );
}
