import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isClerkConfigured } from "@/lib/env";

/**
 * Clerk runs on every request. Next.js 16 renamed `middleware.ts` to
 * `proxy.ts`; Clerk still supplies the handler as `clerkMiddleware()`, and the
 * file convention wants a default export.
 *
 * **Every route is public here, and that is deliberate but temporary.**
 * Spec 0004 builds chrome: `/dashboard` renders the shell over an empty body
 * and touches no tenant row, so there is nothing behind this to leak. What
 * makes it safe is exactly that, and nothing else.
 *
 * **Feature 6 owns the matcher and must narrow it** so the agency route group
 * requires a session, and it must do that before feature 7 puts a real client
 * list behind `/clients`. Spec 0004 records this as a follow up and spec 0004's
 * consequences call it the single real hazard in the feature.
 */
/**
 * Clerk needs a publishable key to run at all. Without one this passes every
 * request straight through, so the product still renders in its signed out
 * state rather than failing to boot. See `isClerkConfigured` in
 * `src/lib/env.ts` for why that matters.
 */
export default isClerkConfigured()
  ? clerkMiddleware()
  : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything except Next's own internals and static files, unless a request
    // carries a search parameter, which a Server Action post does.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run on API and tRPC style routes.
    "/(api|trpc)(.*)",
  ],
};
