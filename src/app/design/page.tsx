import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Wordmark } from "@/ui/patterns/brand";
import { ThemeControl } from "@/ui/patterns/theme-control";

import { Gallery } from "./gallery";

export const metadata: Metadata = {
  title: "Design system",
  // Belt and braces: the route is absent in production anyway.
  robots: { index: false, follow: false },
};

/**
 * Every primitive and pattern, in both themes, in every state it has (AC-16).
 *
 * Why this page exists: without it there is nothing for `/check verify`, the
 * axe suites or a person with a screen reader to point at until feature 7
 * ships a real screen. It is what makes this feature verifiable rather than
 * merely written.
 *
 * Gated on the build mode rather than on a session, because it renders
 * fixtures and nothing else. There is no tenant data here to protect, and a
 * session gate would only mean the page could not be checked before feature 6.
 */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <Wordmark />
        <ThemeControl />
      </header>

      <main className="flex flex-1 flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Design system
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Every component this product is assembled from, in both palettes, in
            every state that applies to it. Nothing here reaches the database:
            each panel is rendered from fixtures. This route does not exist in
            production.
          </p>
        </div>

        {/*
          Both palettes on one screen. The token blocks in globals.css are
          attribute selectors rather than `:root[...]`, which is what lets a
          nested element carry its own theme. On the real pages the attribute
          only ever appears on `<html>`.
        */}
        <div className="grid gap-8 xl:grid-cols-2">
          {(["light", "dark"] as const).map((theme) => (
            <section
              key={theme}
              data-theme={theme}
              aria-labelledby={`palette-${theme}`}
              className="flex min-w-0 flex-col gap-6 rounded-xl border border-border bg-background p-6 text-foreground"
            >
              <h2
                id={`palette-${theme}`}
                className="text-base font-semibold tracking-tight capitalize"
              >
                {theme}
              </h2>
              <Gallery prefix={theme} />
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
