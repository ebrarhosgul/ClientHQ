/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  ALL_NAV,
  isCurrentSection,
  PRIMARY_NAV,
  SECONDARY_NAV,
} from "./navigation";

describe("the paths this product commits to", () => {
  it("lists the work group in the order the sidebar shows it", () => {
    // AC-23 fixes these. Changing one is a change to the spec, and to every
    // feature that was told to build to it.
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/dashboard",
      "/clients",
      "/projects",
      "/invoices",
    ]);
  });

  it("lists the agency group", () => {
    expect(SECONDARY_NAV.map((item) => item.href)).toEqual([
      "/team",
      "/billing",
      "/settings",
    ]);
  });

  it("names every section in words a person would use", () => {
    for (const item of ALL_NAV) {
      expect(item.label).toMatch(/^[A-Z][a-z]/);
    }
  });

  it("says which feature builds each section", () => {
    // So a reader of the sidebar can find out why a link goes nowhere yet.
    for (const item of ALL_NAV) {
      expect(item.feature).toBeGreaterThan(0);
    }
  });

  it("has no duplicate path", () => {
    const hrefs = ALL_NAV.map((item) => item.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("which section you are in", () => {
  it("matches the section's own page", () => {
    expect(isCurrentSection("/clients", "/clients")).toBe(true);
  });

  it("matches a page inside the section", () => {
    expect(isCurrentSection("/clients/9f2a", "/clients")).toBe(true);
  });

  it("matches a page two levels in", () => {
    expect(isCurrentSection("/clients/9f2a/edit", "/clients")).toBe(true);
  });

  it("does not match a different section that starts the same way", () => {
    // A plain `startsWith` would light up Clients on `/clients-archive`.
    expect(isCurrentSection("/clients-archive", "/clients")).toBe(false);
  });

  it("does not match an unrelated section", () => {
    expect(isCurrentSection("/invoices", "/clients")).toBe(false);
  });

  it("marks exactly one section current on any real path", () => {
    for (const pathname of [
      "/dashboard",
      "/clients",
      "/clients/9f2a",
      "/projects/1/edit",
      "/invoices",
      "/team",
      "/billing",
      "/settings",
    ]) {
      const matches = ALL_NAV.filter((item) =>
        isCurrentSection(pathname, item.href),
      );

      expect(
        matches,
        `${pathname} matched ${matches.length} sections`,
      ).toHaveLength(1);
    }
  });
});
