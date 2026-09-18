"use client";

/**
 * The one place that decides whether the browser analytics client exists
 * on this page (spec 0019, AC-14).
 *
 * The provider, and with it `posthog-js`, sits behind `next/dynamic` so its
 * code is a chunk that is only fetched when this gate renders it: on a page
 * outside `/portal`, with a public key, on Vercel production or preview.
 * A portal page never loads the chunk, so "no script from PostHog" holds
 * for our own bundle too, not only for requests to the provider.
 *
 * The two `NEXT_PUBLIC_` reads are spelled out in full so Next inlines them
 * into the browser bundle, the same exemption `isClerkConfigured` has.
 */
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import { isSendingEnvironment } from "@/observability/sentry-enabled";

import { isTrackedPath } from "./tracked-path";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || undefined;
const VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV || undefined;

const AnalyticsProvider = dynamic(
  () => import("./provider").then((module) => module.AnalyticsProvider),
  { ssr: false },
);

export function browserAnalyticsEnabled(pathname: string): boolean {
  return (
    PUBLIC_KEY !== undefined &&
    isSendingEnvironment(VERCEL_ENV) &&
    isTrackedPath(pathname)
  );
}

export function AnalyticsGate() {
  const pathname = usePathname();

  return browserAnalyticsEnabled(pathname) ? (
    <AnalyticsProvider publicKey={PUBLIC_KEY ?? ""} />
  ) : null;
}
