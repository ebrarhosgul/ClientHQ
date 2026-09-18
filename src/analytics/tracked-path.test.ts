/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-14
 */
import { describe, expect, it } from "vitest";

import { isTrackedPath } from "./tracked-path";

describe("isTrackedPath", () => {
  it("is tracked outside the portal", () => {
    expect(isTrackedPath("/")).toBe(true);
    expect(isTrackedPath("/dashboard")).toBe(true);
    expect(isTrackedPath("/invoices/1")).toBe(true);
    expect(isTrackedPath("/privacy")).toBe(true);
  });

  it("is never tracked inside the portal", () => {
    expect(isTrackedPath("/portal")).toBe(false);
    expect(isTrackedPath("/portal/invoices")).toBe(false);
    expect(isTrackedPath("/portal/invoices/1")).toBe(false);
  });

  it("does not treat a path that merely starts with the word portal as the portal", () => {
    expect(isTrackedPath("/portalish")).toBe(true);
  });

  it("is tracked when usePathname has nothing to say (outside the App Router)", () => {
    expect(isTrackedPath(null)).toBe(true);
  });
});
