import Link from "next/link";

import type { AcceptedContactRow } from "@/db/tenant";
import { ClientSwitcher } from "@/portal/ui/client-switcher";
import { ThemeControl } from "@/ui/patterns/theme-control";
import { UserMenu } from "@/ui/shell/user-menu";

/**
 * The portal's own top bar (spec 0014, AC-4): a `banner` landmark carrying
 * the client's company name, the shared theme control and user menu. No
 * sidebar, no primary button, ever.
 *
 * The company name is a link to `/portal` with exactly one accepted row:
 * "plain text" in the spec distinguishes it from the switcher's menu button,
 * not from a link. With more than one row, `ClientSwitcher` replaces the link
 * (AC-11).
 */
export function PortalTopBar({
  clientName,
  rows,
  currentContactId,
}: {
  readonly clientName: string;
  readonly rows: readonly AcceptedContactRow[];
  readonly currentContactId: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {rows.length > 1 ? (
          <ClientSwitcher
            rows={rows}
            currentContactId={currentContactId}
            clientName={clientName}
          />
        ) : (
          <Link href="/portal" className="truncate text-sm font-semibold">
            {clientName}
          </Link>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ThemeControl />
        <UserMenu />
      </div>
    </header>
  );
}
