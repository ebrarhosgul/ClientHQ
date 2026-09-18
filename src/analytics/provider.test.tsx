/**
 * covers: spec 0019 AC-14, AC-15, AC-16, AC-18
 *
 * The browser client's mechanics with `posthog-js` mocked: initialised once
 * with the cookieless settings and `/ingest` as its host, one `$pageview` per
 * pathname with the reduced url, persistence switched on accept, the person
 * identified from Clerk. Whether the provider mounts at all is the gate's
 * decision, tested beside it.
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentProvider } from "./consent-context";
import type { ConsentState } from "./consent-state";

const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  clerkLive: false,
  userId: null as string | null,
  posthog: {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    set_config: vi.fn(),
  },
}));

vi.mock("posthog-js", () => ({ default: state.posthog }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@/ui/shell/identity", () => ({ useClerkLive: () => state.clerkLive }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: state.userId }) }));

const { AnalyticsProvider } = await import("./provider");
const { resetBrowserAnalyticsForTests } = await import("./browser");

function renderProvider(consent: ConsentState = "undecided") {
  return render(
    <ConsentProvider initial={consent}>
      <AnalyticsProvider publicKey="phc_test" />
    </ConsentProvider>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetBrowserAnalyticsForTests();
  state.pathname = "/dashboard";
  state.clerkLive = false;
  state.userId = null;
  state.posthog.init.mockClear();
  state.posthog.capture.mockClear();
  state.posthog.identify.mockClear();
  state.posthog.set_config.mockClear();
});

describe("AnalyticsProvider", () => {
  it("initialises once, cookieless, through /ingest, then captures one page view (AC-14, AC-16)", async () => {
    renderProvider();
    await settle();

    expect(state.posthog.init).toHaveBeenCalledTimes(1);
    expect(state.posthog.init.mock.calls[0]?.[0]).toBe("phc_test");
    expect(state.posthog.init.mock.calls[0]?.[1]).toMatchObject({
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      autocapture: false,
      disable_session_recording: true,
      capture_pageview: false,
      advanced_disable_feature_flags: true,
      persistence: "memory",
    });
    expect(state.posthog.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/dashboard`,
    });
  });

  it("captures a page view on every pathname change, with no query or hash", async () => {
    const { rerender } = renderProvider();
    await settle();

    state.pathname = "/invoices/1";
    window.history.replaceState({}, "", "/invoices/1?tab=events#top");
    rerender(
      <ConsentProvider initial="undecided">
        <AnalyticsProvider publicKey="phc_test" />
      </ConsentProvider>,
    );
    await settle();

    expect(state.posthog.capture).toHaveBeenLastCalledWith("$pageview", {
      $current_url: `${window.location.origin}/invoices/1`,
    });
    expect(state.posthog.capture).toHaveBeenCalledTimes(2);
  });

  it("switches persistence to localStorage+cookie on accept (AC-18)", async () => {
    renderProvider("accepted");
    await settle();

    expect(state.posthog.set_config).toHaveBeenCalledWith({
      persistence: "localStorage+cookie",
    });
  });

  it("identifies the signed in person with no properties when Clerk is live (AC-15)", async () => {
    state.clerkLive = true;
    state.userId = "user_123";
    renderProvider();
    await settle();

    expect(state.posthog.identify).toHaveBeenCalledWith("user_123");
  });
});
