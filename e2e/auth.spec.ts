import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * The routes agency sign in and organization adds, against the real
 * application. Spec 0005, AC-1, AC-3, AC-4, AC-18, AC-20.
 *
 * **These run with no Clerk credentials**, which CI is deliberate about and
 * which spec 0004 already required the shell to handle. Two consequences shape
 * what can be asserted here:
 *
 *  - `src/proxy.ts` is a pass through without a publishable key, so every route
 *    below renders rather than redirecting. What the proxy does *with* a key is
 *    pinned in `src/proxy.test.ts`, which exercises the real matchers.
 *  - `<SignIn />` and `<SignUp />` need a provider, so these three routes render
 *    their "not configured" panel. That panel is real, complete, themed
 *    product surface, so axe over it is a genuine check of the frame, the
 *    heading order, the theme and the contrast; what it cannot check is Clerk's
 *    own markup inside the card.
 *
 * Signing up end to end needs a person, because Clerk puts bot protection in
 * front of it. `verify.md` carries that walk.
 */
const THEMES = ["light", "dark"] as const;
const ROUTES = ["/sign-in", "/sign-up", "/onboarding", "/portal"] as const;

for (const theme of THEMES) {
  test.describe(`the ${theme} theme`, () => {
    for (const route of ROUTES) {
      test(`serves ${route} with no WCAG violation`, async ({ page }) => {
        await page.goto(route);
        await useTheme(page, theme);
        await page.reload();

        await expectNoAccessibilityViolations(page);
      });
    }
  });
}

test.describe("the auth frame", () => {
  test("carries exactly one h1 on each route", async ({ page }) => {
    for (const route of ROUTES) {
      await page.goto(route);

      // The frame holds the brand and the theme control; the card inside it
      // owns the page's one heading, so nothing declares a second.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });

  test("keeps a way back to the entry page", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByRole("link", { name: "ClientHQ" }).first(),
    ).toHaveAttribute("href", "/");
  });

  test("carries the theme control, so a signed out person can still switch", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    await page.getByRole("button", { name: "Dark" }).click();

    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("the routes the entry page promises", () => {
  test("resolves both hrefs on / to real pages", async ({ page }) => {
    // Spec 0004 fixed these two paths on `/` before the routes existed. This is
    // the check that feature 6 landed them where it said it would (AC-1).
    for (const route of ["/sign-in", "/sign-up"] as const) {
      const response = await page.goto(route);

      expect(response?.status(), `${route} did not resolve`).toBe(200);
    }
  });

  test("resolves Clerk's own sub paths, not just the root path", async ({
    page,
  }) => {
    // The catch all segment. Without it a person is locked out halfway through
    // signing in, on the step that proves who they are.
    for (const route of [
      "/sign-in/factor-two",
      "/sign-up/verify-email-address",
    ] as const) {
      const response = await page.goto(route);

      expect(response?.status(), `${route} did not resolve`).toBe(200);
    }
  });
});
