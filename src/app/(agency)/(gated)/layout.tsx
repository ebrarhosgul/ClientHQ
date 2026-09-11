import { redirect } from "next/navigation";

import { agencyAccess } from "@/access/gate";
import { GraceBanner } from "@/access/ui/grace-banner";
import { isClerkConfigured } from "@/lib/env";

/**
 * The access gate, applied to pages by where they sit (spec 0008, AC-4, AC-5,
 * AC-13).
 *
 * A nested route group, so the URLs are unchanged: `/dashboard` is still
 * `/dashboard`. Everything inside `(gated)` needs a paid up agency to render;
 * `/billing` and `/settings` sit outside it on purpose, so a lapsed agency can
 * always reach the page that lets it pay, and the redirect below can never
 * loop. A page added in here later is gated by being here; a page that must
 * stay reachable while lapsed is a deliberate move out, visible in the diff.
 *
 * Three outcomes, decided server side on every full render:
 *
 * - `unsubscribed` or `locked`: sent to `/billing`, which explains itself.
 * - `grace`: the page renders as normal for reading, under one banner saying
 *   why changes are paused and until when. Writes are refused by the action
 *   wrapper regardless of what this layout shows.
 * - `full`: the page, and nothing else.
 *
 * With no Clerk publishable key there is no session and so no agency to gate,
 * and the browser suite in CI renders every page that way. The pass through
 * is the same check the agency layout makes, not a second opinion.
 *
 * A layout does not re render on client side navigation, so a window that
 * lapses mid session keeps reading until the next full load. Spec 0008 accepts
 * that: the wrapper refuses the write immediately either way.
 */
// `LayoutProps<"/">` for the same reason as the agency layout: a route group
// adds no path segment, so Next's generated types place this at the root.
export default async function GatedLayout({ children }: LayoutProps<"/">) {
  if (!isClerkConfigured()) {
    return children;
  }

  const access = await agencyAccess();

  if (access.level === "unsubscribed" || access.level === "locked") {
    redirect("/billing");
  }

  if (access.level === "grace" && access.graceEndsAt !== undefined) {
    return (
      <>
        <GraceBanner graceEndsAt={access.graceEndsAt} role={access.role} />
        {children}
      </>
    );
  }

  return children;
}
