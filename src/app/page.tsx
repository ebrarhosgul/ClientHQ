import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { sessionClaims } from "@/db/tenant/session";
import { isClerkConfigured } from "@/lib/env";
import { Button } from "@/ui/primitives/button";
import { BrandMark } from "@/ui/patterns/brand";
import { ThemeControl } from "@/ui/patterns/theme-control";

export const metadata: Metadata = {
  title: "ClientHQ",
};

/**
 * The way in.
 *
 * Spec 0001 keeps `/` a minimal entry point rather than a marketing page, and
 * spec 0004 pins what it holds: one centred card, the product name, one line
 * saying what this is, a primary Sign in, a secondary Create an agency, and the
 * theme control (AC-17).
 *
 * Both links point at routes feature 6 builds. They are real hrefs on purpose:
 * the paths are fixed here (AC-23) so that feature has no choice to make and no
 * chance to pick a different one.
 *
 * `/` is on the proxy's public list, so it renders for a signed in visitor too,
 * unlike every other route: the root `not-found.tsx` sends here on purpose
 * (its only way back), and a person who follows it while already signed in
 * must not land back on a Sign in button. `/sign-in` only checks this for
 * someone with an active organization; a client contact has none, so without
 * this check here they would end up on Clerk's real sign in form despite
 * already holding a session. `/onboarding` is the one place that already
 * knows where a signed in person with no organization claim belongs.
 */
export default async function Home() {
  if (isClerkConfigured()) {
    const { clerkUserId } = await sessionClaims();

    if (clerkUserId !== undefined) {
      redirect("/onboarding");
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <BrandMark className="size-7" />
        <ThemeControl />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">
          <div className="rounded-lg border border-border bg-card p-8 text-card-foreground">
            <h1 className="text-xl font-semibold tracking-tight">ClientHQ</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Where your agency runs its clients, projects, deliverables and
              invoices, and every client sees their own work.
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link href="/sign-up">Create an agency</Link>
              </Button>
            </div>
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
            Signing in is for agency staff and invited client contacts. Ask your
            agency for an invitation if you do not have one.
          </p>
        </div>
      </main>
    </div>
  );
}
