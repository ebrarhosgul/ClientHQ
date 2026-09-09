import { cn } from "@/ui/lib/cn";

/**
 * The mark and the wordmark.
 *
 * Drawn rather than loaded: an SVG built from the token colours is one less
 * asset to ship, it stays sharp at any size, and it repaints correctly when the
 * theme changes, which a raster logo would not. The shape is two stacked
 * brackets, the product reduced to what it does, hold a client's work in one
 * place.
 *
 * Decorative wherever the word "ClientHQ" is beside it, which is everywhere it
 * is used today, so it is hidden from assistive technology.
 */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={cn("size-6 text-primary", className)}
    >
      <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
      <path
        d="M8 8.5h8M8 12h5.5M8 15.5h8"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({
  className,
  markClassName,
}: {
  readonly className?: string;
  readonly markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark className={markClassName} />
      <span className="font-semibold tracking-tight">ClientHQ</span>
    </span>
  );
}
