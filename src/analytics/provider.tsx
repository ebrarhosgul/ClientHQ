"use client";

/**
 * Page views from the browser (spec 0019, AC-14, AC-15, AC-18).
 *
 * Mounted by `AnalyticsGate`, and only there: by the time this renders, the
 * page is outside `/portal`, a public key exists and the SDK may send. It
 * renders nothing visible. One load, one `$pageview` per pathname with the
 * reduced url, the consent choice applied in place, and the signed in
 * person identified through Clerk's own hook.
 *
 * `IdentifiedAnalytics` is mounted only when Clerk is live, so its
 * `useAuth()` call is unconditional inside a tree that has a
 * `ClerkProvider`, the same shape the shell already uses.
 */
import { useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useClerkLive } from "@/ui/shell/identity";

import {
  applyConsent,
  capturePageview,
  ensureBrowserAnalytics,
  identifyBrowser,
} from "./browser";
import { useConsent } from "./consent-context";

function IdentifiedAnalytics() {
  const { userId } = useAuth();

  useEffect(() => {
    if (typeof userId === "string") {
      identifyBrowser(userId);
    }
  }, [userId]);

  return null;
}

export function AnalyticsProvider({
  publicKey,
}: {
  readonly publicKey: string;
}) {
  const pathname = usePathname();
  const clerkLive = useClerkLive();
  const { consent } = useConsent();

  // One load, then a page view for every pathname, the initial one included.
  useEffect(() => {
    let cancelled = false;

    void ensureBrowserAnalytics({ key: publicKey, consent }).then(() => {
      if (!cancelled) {
        capturePageview(pathname);
      }
    });

    return () => {
      cancelled = true;
    };
    // `consent` only seeds the first load; changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, pathname]);

  useEffect(() => {
    applyConsent(consent);
  }, [consent]);

  return clerkLive ? <IdentifiedAnalytics /> : null;
}
