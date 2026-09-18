"use client";

/**
 * The browser side of analytics (spec 0019, AC-14, AC-15, AC-18): page
 * views only, through this app's own `/ingest` path, with no cookie until
 * the person accepts one.
 *
 * `posthog-js` is loaded with a dynamic import the first time a page outside
 * `/portal` asks for it, so its code is a chunk the portal never fetches, and
 * held here as the one browser instance. Every function is a no op before
 * that load and never throws: analytics failing is not a page failing.
 *
 * The only file in the project that imports `posthog-js` (key invariant 1).
 */
import type { PostHog } from "posthog-js";

import type { ConsentState } from "./consent-state";

/**
 * Properties `posthog-js` attaches to every event on its own, outside the
 * catalogue's `NoPlainString` rule (AC-9): `document.referrer` and the
 * campaign params it derives can carry a full URL, query string and all, so
 * a link into a token bearing page (`/portal/accept?token=…`) would leak
 * that token to the very first event captured after it. Denylisted rather
 * than reduced, because nothing downstream in this product reads them.
 */
const DENYLISTED_PROPERTIES = [
  "$referrer",
  "$referring_domain",
  "$initial_referrer",
  "$initial_referring_domain",
  "$initial_current_url",
  "$initial_pathname",
] as const;

export type BrowserAnalyticsConfig = {
  readonly key: string;
  readonly consent: ConsentState;
};

/** The persistence the consent choice allows (AC-18). */
export function persistenceFor(
  consent: ConsentState,
): "memory" | "localStorage+cookie" {
  return consent === "accepted" ? "localStorage+cookie" : "memory";
}

/** `$current_url` as sent: origin plus pathname, no query, no hash (AC-14). */
export function reducedUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}`;
}

// The one instance, the load in flight so two callers share it, and the
// calls made before anyone asked for a load (a child effect runs before its
// parent's, so `identify` can arrive first). Module level state on the same
// terms as `env()`'s cache.
let instance: PostHog | undefined;
let loading: Promise<PostHog | undefined> | undefined;
const pending: ((posthog: PostHog) => void)[] = [];

async function load(
  config: BrowserAnalyticsConfig,
): Promise<PostHog | undefined> {
  try {
    const { default: posthog } = await import("posthog-js");

    posthog.init(config.key, {
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      persistence: persistenceFor(config.consent),
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      advanced_disable_feature_flags: true,
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      rageclick: false,
      property_denylist: [...DENYLISTED_PROPERTIES],
    });

    instance = posthog;
    pending.splice(0, pending.length).forEach((fn) => {
      fn(posthog);
    });

    return posthog;
  } catch {
    return undefined;
  }
}

/** Test seam: forget the instance so the next page loads it again. */
export function resetBrowserAnalyticsForTests(): void {
  instance = undefined;
  loading = undefined;
  pending.splice(0, pending.length);
}

/** Load once. Later calls return the same instance. */
export function ensureBrowserAnalytics(
  config: BrowserAnalyticsConfig,
): Promise<PostHog | undefined> {
  loading ??= load(config);

  return loading;
}

/**
 * Run against the instance: now if it is loaded, otherwise once a load
 * completes. On a page that never loads analytics (the portal) the call
 * simply waits forever, which is the same as never.
 */
function withInstance(fn: (posthog: PostHog) => void): void {
  const safely = (posthog: PostHog): void => {
    try {
      fn(posthog);
    } catch {
      // Never into the page.
    }
  };

  if (instance !== undefined) {
    safely(instance);
  } else {
    pending.push(safely);
  }
}

export function capturePageview(pathname: string): void {
  withInstance((posthog) => {
    posthog.capture("$pageview", {
      $current_url: reducedUrl(window.location.origin, pathname),
    });
  });
}

/** Join page views to the person the server side events belong to (AC-15). */
export function identifyBrowser(clerkUserId: string): void {
  withInstance((posthog) => {
    posthog.identify(clerkUserId);
  });
}

/** Switch persistence in place when the choice changes (AC-18). */
export function applyConsent(consent: ConsentState): void {
  withInstance((posthog) => {
    posthog.set_config({ persistence: persistenceFor(consent) });
  });
}
