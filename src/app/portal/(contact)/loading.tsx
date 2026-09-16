import { OverviewSection } from "@/portal/ui/overview-section";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/** Three skeleton rows, the shape of a populated overview block. */
function BlockSkeleton({ label }: { readonly label: string }) {
  return (
    <SkeletonRegion label={label}>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {[0, 1, 2].map((row) => (
          <li
            key={row}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </li>
        ))}
      </ul>
    </SkeletonRegion>
  );
}

/**
 * The overview's own loading state (spec 0014, AC-15): the real headings and
 * `See all` links through the same `OverviewSection` the populated page uses,
 * so only the three data dependent blocks are skeletons.
 */
export default function PortalOverviewLoading() {
  return (
    <div className="flex flex-col gap-8">
      <OverviewSection id="projects" title="Projects">
        <BlockSkeleton label="Loading projects" />
      </OverviewSection>
      <OverviewSection id="files" title="Files">
        <BlockSkeleton label="Loading files" />
      </OverviewSection>
      <OverviewSection id="invoices" title="Invoices">
        <BlockSkeleton label="Loading invoices" />
      </OverviewSection>
    </div>
  );
}
