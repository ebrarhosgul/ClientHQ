import type { ReactNode } from "react";
import Link from "next/link";

/**
 * One of the overview's three blocks (spec 0014, AC-5): a heading and a
 * `See all` link to the section's own page. Shared with `(contact)/loading.tsx`
 * so the loading shape and the populated shape cannot drift apart.
 */
export function OverviewSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const headingId = `overview-${id}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id={headingId} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <Link href={`/portal/${id}`} className="link-accent text-sm">
          See all
        </Link>
      </div>
      {children}
    </section>
  );
}
