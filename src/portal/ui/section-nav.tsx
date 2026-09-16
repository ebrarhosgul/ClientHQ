"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/ui/lib/cn";
import { isCurrentSection } from "@/ui/shell/navigation";

const SECTIONS = [
  { href: "/portal/projects", label: "Projects" },
  { href: "/portal/files", label: "Files" },
  { href: "/portal/invoices", label: "Invoices" },
] as const;

/**
 * The three links every portal page shares (spec 0014, AC-4): a `navigation`
 * landmark labelled "Portal sections", with the current one marked by
 * `aria-current="page"` rather than colour alone. All three fit at 320
 * pixels and stay visible; there is no menu button at any width.
 *
 * A client component only because it compares the current path, the same
 * reason `SidebarNav` is one; it reads no session and runs no query.
 */
export function SectionNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal sections"
      className="border-b border-border px-3 md:px-6"
    >
      <ul className="flex gap-4">
        {SECTIONS.map((section) => {
          const current = isCurrentSection(pathname, section.href);

          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center border-b-2 text-sm font-medium transition-surface",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
