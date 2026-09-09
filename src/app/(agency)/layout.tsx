import { AppShell } from "@/ui/shell/app-shell";

/**
 * Every agency section renders inside the shell.
 *
 * A route *group*, so the paths stay flat: `/dashboard`, `/clients`,
 * `/invoices` and the rest, exactly as spec 0001 fixed them and AC-23 pins
 * them. The parentheses keep `(agency)` out of the URL.
 *
 * This layout deliberately resolves no tenant context and checks no session.
 * Feature 6 narrows the proxy matcher so a session is required to get here at
 * all, and each feature's own page reads its rows through spec 0003's layer.
 */
// `LayoutProps<"/">`, not `<"/dashboard">`: a route group adds no path
// segment, so as far as Next's generated types are concerned this layout sits
// at the root alongside the one in `src/app/layout.tsx`.
export default function AgencyLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
