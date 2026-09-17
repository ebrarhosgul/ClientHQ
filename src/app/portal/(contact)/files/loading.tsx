import { PageHeader } from "@/ui/patterns/page-header";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * `/portal/files`'s own loading state (spec 0014, AC-15): the real header,
 * then a skeleton the shape of the grouped file list (a heading per project,
 * a row per file).
 */
export default function PortalFilesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Files"
        description="Every file your agency has shared with you, newest first."
      />

      <SkeletonRegion label="Loading files" className="flex flex-col gap-6">
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
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
        ))}
      </SkeletonRegion>
    </div>
  );
}
