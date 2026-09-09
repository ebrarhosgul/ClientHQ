import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isClerkConfigured } from "@/lib/env";

/**
 * The only routes reachable without a session.
 *
 * Everything not on this list is protected, including a route nobody has
 * written yet. That is the point: feature 7 puts real client rows behind
 * `/clients`, and it inherits protection by being new rather than by someone
 * remembering to add it here (AC-4).
 *
 * The two wildcards are load bearing, not tidiness. Clerk drives email
 * verification, second factor and SSO callback steps on sub paths of
 * `/sign-in` and `/sign-up`, and a bare `/sign-in` would lock a person out
 * halfway through signing in.
 *
 * Exported so `src/proxy.test.ts` can pin both lists against the spec: this
 * matcher is the single most consequential line in the feature, and a quiet
 * edit to it is what would make the agency area readable again.
 *
 * The webhook and cron routes are public because their callers carry no
 * session: each verifies its own signature or secret instead. They do not
 * exist yet (features 8, 17 and 18), and are listed now so those features do
 * not have to widen this list while shipping something else.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
] as const;

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES]);

/**
 * The agency area: the seven paths `src/ui/shell/navigation.ts` commits to.
 *
 * Only these carry the "you must be acting as an agency" check. `/onboarding`
 * and `/portal` are deliberately outside it (AC-20): a client contact never
 * carries an organization claim, so including them would bounce a contact back
 * to `/onboarding` on every single page load, and `/onboarding` itself would
 * redirect to itself forever.
 */
export const AGENCY_ROUTES = [
  "/dashboard(.*)",
  "/clients(.*)",
  "/projects(.*)",
  "/invoices(.*)",
  "/team(.*)",
  "/billing(.*)",
  "/settings(.*)",
] as const;

const isAgencyRoute = createRouteMatcher([...AGENCY_ROUTES]);

/**
 * The proxy (Next 16's name for what used to be middleware).
 *
 * Two decisions, both made from session claims alone with no database call, so
 * this stays inside spec 0001's Supabase pooler constraints: is there a
 * session, and does it name an active organization. Whether the local mirror
 * rows exist is not asked here. That is the agency layout's job, because
 * answering it needs a query.
 *
 * With no Clerk publishable key the whole thing is a pass through, which is
 * what lets the browser suite run in CI with no provider credentials and what
 * lets someone clone this repository and look at it (see `src/lib/env.ts`).
 */
export default isClerkConfigured()
  ? clerkMiddleware(async (auth, request) => {
      if (isPublicRoute(request)) {
        return NextResponse.next();
      }

      const { userId, orgId, redirectToSignIn } = await auth();

      if (!userId) {
        return redirectToSignIn({ returnBackUrl: request.url });
      }

      if (!orgId && isAgencyRoute(request)) {
        return NextResponse.redirect(new URL("/onboarding", request.url));
      }

      return NextResponse.next();
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
