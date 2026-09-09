import { AuthFrame } from "@/auth/ui/auth-frame";

/**
 * The frame every page you see before you are inside an agency shares.
 *
 * Sign in, sign up and onboarding all sit here: a person on one of these has no
 * agency chrome to render, because they may not have an agency yet. The frame
 * matches `/` deliberately (spec 0004, AC-17), so arriving from the entry page
 * feels like one product rather than a handoff to a provider.
 *
 * A route *group*, so the paths stay flat: `/sign-in`, `/sign-up` and
 * `/onboarding`, exactly as spec 0005 pins them. The parentheses keep `(auth)`
 * out of the URL.
 */
// `LayoutProps<"/">` for the same reason the agency layout uses it: a route
// group adds no path segment, so Next's generated types put this layout at the
// root alongside the one in `src/app/layout.tsx`.
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <AuthFrame>{children}</AuthFrame>;
}
