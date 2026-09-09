"use client";

import "./globals.css";

/**
 * The last boundary: the root layout itself threw.
 *
 * This component *replaces* the root layout, so nothing the layout does has
 * happened. That is why it looks different from everything else here:
 *
 * - it renders its own `<html>` and `<body>`, because none exist yet
 * - it imports `globals.css` itself, because the layout's import never ran
 * - it stamps no `data-theme`, because the cookie was never read, so the
 *   `prefers-color-scheme` block decides and the page is still the right colour
 * - it uses the system font stack, because `next/font` never loaded Inter
 *
 * It also deliberately does not import `ErrorState`: if the failure was in a
 * shared module, importing more of the same tree is how a fallback fails too.
 * The markup below is the shared error state written out by hand, on purpose.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div
            role="alert"
            className="flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center"
          >
            <p className="text-base font-semibold text-card-foreground">
              Something went wrong
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              The application could not start. Nothing you did caused it, and
              nothing has been lost.
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
