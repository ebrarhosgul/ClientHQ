import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/ui/patterns/brand";
import { ThemeControl } from "@/ui/patterns/theme-control";

export type AuthFrameProps = {
  readonly children: ReactNode;
};

/**
 * The chrome around sign in, sign up and onboarding.
 *
 * Deliberately the same shape as `/`: the brand top left, the theme control top
 * right, one centred column, and a closing line saying who this product is for.
 * Someone who pressed "Sign in" on the entry page should not be able to tell
 * they crossed into a different part of the application, let alone that a
 * provider is rendering the form.
 *
 * The frame is chrome and nothing else. It runs no query and resolves no tenant
 * context; each page inside it decides what it needs.
 */
export function AuthFrame({ children }: AuthFrameProps) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="rounded-sm text-sm">
          <Wordmark markClassName="size-7" />
        </Link>
        <ThemeControl />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        {children}
      </main>

      <footer className="px-6 pb-8">
        <p className="mx-auto max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
          ClientHQ is where agencies run their clients, projects, deliverables
          and invoices. Invited client contacts sign in here too, and land in
          their own portal.
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy notice
          </Link>
        </p>
      </footer>
    </div>
  );
}
