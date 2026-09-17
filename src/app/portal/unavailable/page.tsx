import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listAcceptedContactRows } from "@/db/tenant";
import { isClerkConfigured } from "@/lib/env";
import { unavailableCopy } from "@/portal/copy";
import { portalContextForUnavailable } from "@/portal/context";
import { isPortalReadable } from "@/portal/gate";
import { ClientSwitcher } from "@/portal/ui/client-switcher";
import { PortalSignOutLink } from "@/portal/ui/portal-sign-out-link";
import { ThemeControl } from "@/ui/patterns/theme-control";
import { MAIN_CONTENT_ID, SkipLink } from "@/ui/shell/skip-link";

export const metadata: Metadata = {
  title: "Portal unavailable · ClientHQ",
};

/**
 * Where a locked or unsubscribed agency's contact lands (spec 0014, AC-2,
 * AC-3). Its own minimal frame, outside the `(contact)` chrome: this is not a
 * readable page, so it carries none of the section strip.
 *
 * `portalContextForUnavailable()` resolves with no gate redirect, which is
 * what lets this page render *for* the unreadable case instead of redirecting
 * to itself; this page applies the same `isPortalReadable` check itself, the
 * other direction, so a switch (or the agency becoming readable again) sends
 * the person back to `/portal` rather than leaving them stranded here.
 *
 * With no Clerk publishable key there is no session to resolve an access
 * level from, so this renders a generic, session free version of the same
 * frame rather than resolving a tenant context that cannot exist (spec 0004,
 * AC-22).
 */
export default async function PortalUnavailablePage() {
  if (!isClerkConfigured()) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <SkipLink />

        <header className="flex items-center justify-end gap-2 px-6 py-5">
          <ThemeControl />
        </header>

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 flex-col items-center justify-center px-6 pb-16"
        >
          <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Portal unavailable
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This copy of ClientHQ has no Clerk credentials, so there is no
              session to check.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const { ctx, access, clientName, agencyName } =
    await portalContextForUnavailable();

  if (isPortalReadable(access.level)) {
    redirect("/portal");
  }

  const copy = unavailableCopy(agencyName);
  const rows = await listAcceptedContactRows(ctx.userId);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SkipLink />

      <header className="flex items-center justify-between gap-2 px-6 py-5">
        {rows.length > 1 ? (
          <ClientSwitcher
            rows={rows}
            currentContactId={ctx.contactId}
            clientName={clientName}
          />
        ) : (
          <span className="truncate text-sm font-semibold">{clientName}</span>
        )}
        <ThemeControl />
      </header>

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-6 pb-16"
      >
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            {copy.heading}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {copy.body}
          </p>
          <PortalSignOutLink />
        </div>
      </main>
    </div>
  );
}
