import { PageHeader } from "@/ui/patterns/page-header";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

/**
 * What `/billing` shows while the subscription row is being read (spec 0007,
 * AC-19: every state this page can render meets WCAG 2.2 AA, this one
 * included).
 *
 * The header is real rather than a grey box: the title and the sentence under
 * it are known before the query runs, so showing placeholders for them would be
 * pretending not to know something. Only the card waits.
 *
 * `SkeletonRegion` is what announces the wait, once and in words. The shapes
 * inside it are hidden from assistive technology, which is the project's
 * convention for every skeleton (spec 0004, AC-14).
 */
export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Your agency's subscription to this product. Nothing your own clients pay you passes through here."
      />

      <SkeletonRegion label="Loading your subscription" className="max-w-2xl">
        <Card>
          <CardHeader className="gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full max-w-md" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      </SkeletonRegion>
    </div>
  );
}
