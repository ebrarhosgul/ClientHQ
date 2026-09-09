"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/ui/lib/cn";

import {
  isCurrentSection,
  PRIMARY_NAV,
  SECONDARY_NAV,
  type NavItem,
} from "./navigation";

/**
 * The two navigation groups.
 *
 * A client component only because it compares the current path against each
 * item's `href`. It reads no session and runs no query: the shell is chrome and
 * nothing else (invariant 3).
 *
 * `aria-current="page"` on the current item, not just a colour, so a screen
 * reader user knows where they are (AC-6).
 */
function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly pathname: string;
  readonly onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const current = isCurrentSection(pathname, item.href);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-surface",
                  current
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SidebarNav({
  onNavigate,
  className,
}: {
  /** Closes the mobile sheet after a tap. Absent on the fixed sidebar. */
  readonly onNavigate?: () => void;
  readonly className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className={cn("flex flex-col gap-2", className)}>
      <NavGroup
        label="Work"
        items={PRIMARY_NAV}
        pathname={pathname}
        onNavigate={onNavigate}
      />
      <NavGroup
        label="Agency"
        items={SECONDARY_NAV}
        pathname={pathname}
        onNavigate={onNavigate}
      />
    </nav>
  );
}
