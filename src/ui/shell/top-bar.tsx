import type { ReactNode } from "react";

import { ThemeControl } from "@/ui/patterns/theme-control";

import { AgencySwitcher } from "./agency-switcher";
import { MobileNavSheet } from "./mobile-nav-sheet";
import { UserMenu } from "./user-menu";

/**
 * The slim bar across the top: the menu button below `md`, the agency switcher,
 * a breadcrumb slot, the theme control and the user menu.
 *
 * The breadcrumb is a *slot*, not something the shell derives. A path segment
 * is an id, and `/clients/9f2a…` is not a label anybody wants to read, so each
 * feature's own layout fills it with real names it already has in hand.
 */
export function TopBar({ breadcrumb }: { readonly breadcrumb?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-6">
      <MobileNavSheet />

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <AgencySwitcher />
        {breadcrumb ? (
          <>
            <span aria-hidden className="text-muted-foreground">
              /
            </span>
            <div className="min-w-0 truncate">{breadcrumb}</div>
          </>
        ) : undefined}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeControl />
        <UserMenu />
      </div>
    </header>
  );
}
