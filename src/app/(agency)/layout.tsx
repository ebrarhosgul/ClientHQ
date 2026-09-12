import { AppShell } from "@/ui/shell/app-shell";

/**
 * Every agency section renders inside the shell.
 *
 * A route *group*, so the paths stay flat: `/dashboard`, `/clients`,
 * `/invoices` and the rest, exactly as spec 0001 fixed them and spec 0004's
 * AC-23 pins them. The parentheses keep `(agency)` out of the URL.
 *
 * This layout reads nothing, and that is load bearing. Next lets a segment's
 * `error.tsx` catch a throw from that segment's page and children, never from
 * the segment's own layout, so a database read up here that failed would skip
 * `./error.tsx` and land on the root boundary with no shell around it. The
 * first read in the agency area is therefore one segment lower: the `(gated)`
 * layout resolves the context and the access level for every gated page, and
 * `/billing` resolves them itself. A read that fails there renders inside the
 * shell with a way to billing (spec 0008, AC-12).
 *
 * The mirror repair (spec 0005, AC-12) lives inside `agencyContext()`, not
 * here, so it still runs on the first read of every request that touches
 * agency data, and it still costs nothing on the normal path.
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
export default function AgencyLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
