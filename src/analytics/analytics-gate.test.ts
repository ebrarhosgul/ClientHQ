// @vitest-environment node
/**
 * covers: spec 0019 AC-14
 *
 * The gate's decision, with the public key and Vercel environment stubbed
 * before the module is imported (Next inlines both at build, and the module
 * reads them once).
 */
import { describe, expect, it, vi } from "vitest";

vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { browserAnalyticsEnabled } = await import("./analytics-gate");
const { isTrackedPath } = await import("./tracked-path");

describe("the browser analytics gate", () => {
  it("mounts the client outside /portal only", () => {
    expect(browserAnalyticsEnabled("/")).toBe(true);
    expect(browserAnalyticsEnabled("/dashboard")).toBe(true);
    expect(browserAnalyticsEnabled("/sign-in")).toBe(true);
    expect(browserAnalyticsEnabled("/portal")).toBe(false);
    expect(browserAnalyticsEnabled("/portal/invoices/1")).toBe(false);
  });

  it("treats only the portal prefix as untracked, not a lookalike", () => {
    expect(isTrackedPath("/portalx")).toBe(true);
    expect(isTrackedPath("/portal/")).toBe(false);
  });
});
