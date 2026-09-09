import { agencyContext } from "@/auth/context";
import { isClerkConfigured } from "@/lib/env";
import { AppShell } from "@/ui/shell/app-shell";

/**
 * Every agency section renders inside the shell.
 *
 * A route *group*, so the paths stay flat: `/dashboard`, `/clients`,
 * `/invoices` and the rest, exactly as spec 0001 fixed them and spec 0004's
 * AC-23 pins them. The parentheses keep `(agency)` out of the URL.
 *
 * Resolving the context here is what anchors the mirror repair to the whole
 * agency area rather than to one page (spec 0005, AC-12). It costs nothing on
 * the normal path: `agencyContext()` is cached for the request, so the page
 * below reads the same resolution rather than running a second query.
 *
 * `src/proxy.ts` is what guarantees there is a session and an active
 * organization by the time this renders. With no Clerk publishable key the
 * proxy is a pass through and there is no session to resolve, which is the case
 * spec 0004's AC-22 requires the shell to handle by rendering its signed out
 * state, and which the browser suite in CI depends on.
 */
// `LayoutProps<"/">`, not `<"/dashboard">`: a route group adds no path
// segment, so as far as Next's generated types are concerned this layout sits
// at the root alongside the one in `src/app/layout.tsx`.
export default async function AgencyLayout({ children }: LayoutProps<"/">) {
  if (isClerkConfigured()) {
    await agencyContext();
  }

  return <AppShell>{children}</AppShell>;
}
