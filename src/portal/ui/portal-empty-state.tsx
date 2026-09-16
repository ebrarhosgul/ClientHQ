import { EmptyState } from "@/ui/patterns/empty-state";

/**
 * The portal's own empty state: `EmptyState` with no action slot at all,
 * because the portal is read only and never invites an action (design.md,
 * "The client portal"; spec 0014, AC-5).
 */
export function PortalEmptyState({
  heading,
  description,
}: {
  readonly heading: string;
  readonly description: string;
}) {
  return <EmptyState heading={heading} description={description} />;
}
