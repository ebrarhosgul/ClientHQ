/**
 * @vitest-environment node
 *
 * covers: spec 0005 AC-4, AC-5, AC-20
 *
 * The two matchers, pinned.
 *
 * Spec 0005 calls the proxy matcher the single most consequential line in the
 * feature, because it is what stops the agency area being publicly readable
 * once feature 7 puts real client rows behind it. A quiet edit that adds a path
 * to the public list, or drops one from the organization check, has no other
 * symptom: everything still renders, for everyone.
 *
 * So this asserts the lists themselves against the acceptance criteria, and
 * then runs the real `createRouteMatcher` over concrete paths, including the
 * sub paths Clerk drives its own steps on and a route nobody has written yet.
 */
import { createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { AGENCY_ROUTES, PUBLIC_ROUTES } from "./proxy";
import { ALL_NAV } from "./ui/shell/navigation";

const isPublic = createRouteMatcher([...PUBLIC_ROUTES]);
const isAgency = createRouteMatcher([...AGENCY_ROUTES]);

const request = (path: string) =>
  new NextRequest(new URL(path, "https://clienthq.test"));

describe("the public list (AC-4)", () => {
  it("is exactly what the spec fixes, and nothing else", () => {
    expect([...PUBLIC_ROUTES]).toEqual([
      "/",
      "/sign-in(.*)",
      "/sign-up(.*)",
      "/api/webhooks/(.*)",
      "/api/cron/(.*)",
      "/privacy",
      "/ingest/(.*)",
    ]);
  });

  it.each([
    "/",
    "/sign-in",
    "/sign-up",
    "/api/webhooks/stripe",
    "/api/webhooks/clerk",
    "/api/cron/daily",
    "/privacy",
    "/ingest/e/",
    "/ingest/static/array.js",
  ])("lets %s through without a session", (path) => {
    expect(isPublic(request(path))).toBe(true);
  });

  it.each([
    "/sign-in/factor-two",
    "/sign-in/sso-callback",
    "/sign-up/verify-email-address",
    "/sign-up/continue",
  ])("lets Clerk's own sub path %s through", (path) => {
    // The wildcards are required, not cosmetic. Without them a person is locked
    // out halfway through signing in, on the step that proves who they are.
    expect(isPublic(request(path))).toBe(true);
  });

  it.each([
    "/dashboard",
    "/clients",
    "/onboarding",
    "/portal",
    "/design",
    "/api/health/db",
    "/a-route-nobody-has-written-yet",
  ])("protects %s", (path) => {
    expect(isPublic(request(path))).toBe(false);
  });

  it("fails closed: a new route is protected by existing", () => {
    // The property that matters more than any single path above. Feature 7
    // inherits protection by being new, not by someone remembering.
    expect(isPublic(request("/invoices/2026/03/draft"))).toBe(false);
  });
});

describe("the agency organization check (AC-5, AC-20)", () => {
  it("covers exactly the paths the shell commits to", () => {
    const navPaths = [...new Set(ALL_NAV.map((item) => item.href))].sort();
    const matched = [...AGENCY_ROUTES]
      .map((pattern) => pattern.replace("(.*)", ""))
      .sort();

    expect(matched).toEqual(navPaths);
  });

  it.each([
    "/dashboard",
    "/clients",
    "/clients/some-id",
    "/projects",
    "/invoices",
    "/team",
    "/billing",
    "/settings",
  ])("requires an active organization on %s", (path) => {
    expect(isAgency(request(path))).toBe(true);
  });

  it.each(["/onboarding", "/portal"])(
    "leaves %s outside the organization check",
    (path) => {
      // AC-20. A client contact never carries an organization claim, so
      // including either path would bounce them back to `/onboarding` on every
      // load, and `/onboarding` would redirect to itself forever.
      expect(isAgency(request(path))).toBe(false);
    },
  );

  it.each(["/", "/sign-in", "/sign-up", "/design"])(
    "leaves %s outside the organization check",
    (path) => {
      expect(isAgency(request(path))).toBe(false);
    },
  );
});
