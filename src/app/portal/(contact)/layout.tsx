import { listAcceptedContactRows } from "@/db/tenant";
import { isClerkConfigured } from "@/lib/env";
import { portalContext } from "@/portal/context";
import { PortalTopBar } from "@/portal/ui/portal-top-bar";
import { SectionNav } from "@/portal/ui/section-nav";
import { MAIN_CONTENT_ID, SkipLink } from "@/ui/shell/skip-link";

/**
 * The portal's own chrome (spec 0014, AC-4): the skip link, the top bar, the
 * section strip, then the page. No sidebar, at any width.
 *
 * It calls `portalContext()` for the top bar's client name, unlike the agency
 * shell, which reads nothing and lets `AgencySwitcher` resolve its own name
 * client side: the portal's name comes from this database, not from a Clerk
 * hook, so it has to be resolved here. `portalContext()` is the same
 * `cache()`-wrapped call every page under it makes for its own query, so this
 * costs no second resolution on the normal path.
 *
 * With no Clerk publishable key there is no session to resolve, so this
 * renders the page with no chrome around it, exactly what `(gated)/layout.tsx`
 * does on the agency side; the browser suite in CI runs with no Clerk
 * credentials at all (spec 0004, AC-22).
 */
export default async function ContactLayout({
  children,
}: LayoutProps<"/portal">) {
  if (!isClerkConfigured()) {
    return children;
  }

  const { ctx, clientName } = await portalContext();
  const rows = await listAcceptedContactRows(ctx.userId);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SkipLink />
      <PortalTopBar
        clientName={clientName}
        rows={rows}
        currentContactId={ctx.contactId}
      />
      <SectionNav />

      <main
        id={MAIN_CONTENT_ID}
        data-scroll-region
        tabIndex={-1}
        className="flex flex-1 flex-col gap-6 px-4 py-6 md:px-6"
      >
        {children}
      </main>
    </div>
  );
}
