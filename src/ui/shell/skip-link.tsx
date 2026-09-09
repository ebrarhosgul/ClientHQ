import { cn } from "@/ui/lib/cn";

/** Where the skip link lands, and what the shell wraps its content in. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * The first focusable element on every page.
 *
 * Someone using a keyboard should not have to tab through eight sidebar links
 * on every single page to reach the thing they came for (WCAG 2.4.1). It is
 * invisible until it has focus, and then it is a real, visible control, not a
 * one pixel box someone technically focused.
 */
export function SkipLink({ className }: { readonly className?: string }) {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className={cn(
        "sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50",
        "focus-visible:inline-flex focus-visible:h-9 focus-visible:items-center focus-visible:rounded-md",
        "focus-visible:bg-primary focus-visible:px-4 focus-visible:text-sm focus-visible:font-medium",
        "focus-visible:text-primary-foreground",
        className,
      )}
    >
      Skip to content
    </a>
  );
}
