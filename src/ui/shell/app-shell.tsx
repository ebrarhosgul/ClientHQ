import type { ReactNode } from "react";

import { Wordmark } from "@/ui/patterns/brand";

import { SidebarNav } from "./sidebar-nav";
import { MAIN_CONTENT_ID, SkipLink } from "./skip-link";
import { TopBar } from "./top-bar";

/**
 * The agency chrome: a fixed sidebar, a sticky top bar, and the page inside.
 *
 * **This is chrome and nothing else.** It runs no query, resolves no tenant
 * context and decides no permission (invariant 3). Those belong to spec 0003's
 * layer and to each feature's own layout, and keeping them out of here is what
 * lets the shell render for a signed out visitor without crashing.
 *
 * The skip link is the first focusable element on the page, so a keyboard user
 * reaches the content without tabbing the whole sidebar (AC-6).
 */
export function AppShell({
  children,
  breadcrumb,
}: {
  readonly children: ReactNode;
  readonly breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1">
      <SkipLink />

      {/*
        Fixed, and its own scroll container, so a long client list scrolls
        without taking the navigation off screen with it.
      */}
      <div className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex h-14 shrink-0 items-center px-4">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <SidebarNav />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar breadcrumb={breadcrumb} />

        {/*
          `scroll-padding-top` (globals.css) reserves the top bar's height, so
          a focused element the browser scrolls to never lands underneath it
          (WCAG 2.2, 2.4.11).
        */}
        <main
          id={MAIN_CONTENT_ID}
          data-scroll-region
          tabIndex={-1}
          className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
