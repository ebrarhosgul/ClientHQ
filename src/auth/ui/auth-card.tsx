import type { ReactNode } from "react";

export type AuthCardProps = {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  /** A quieter line under the card, for the thing that is not the main path. */
  readonly footer?: ReactNode;
};

/**
 * The card every page in the `(auth)` group is built from.
 *
 * The same shape as the one on `/`, down to the padding and the type sizes,
 * because these pages are the continuation of that one. It carries the page's
 * `h1`, so nothing inside it declares another.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: AuthCardProps) {
  return (
    <div className="w-full max-w-sm">
      <div className="rounded-lg border border-border bg-card p-8 text-card-foreground">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-6">{children}</div>
      </div>

      {footer ? (
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          {footer}
        </p>
      ) : undefined}
    </div>
  );
}
