import { expect, test, type Page } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Consent, the privacy notice and provider isolation against the real app
 * (spec 0019, AC-14, AC-17, AC-18, AC-19, AC-22).
 *
 * This server runs with no provider variable at all, so the strongest thing
 * it can prove about the analytics client is the one AC-22 asks for: no
 * request leaves for `/ingest` or `sentry.io`, on any route. The client's
 * own mechanics (init, page views, identify, persistence) are proven in
 * `src/analytics/provider.test.tsx` with `posthog-js` mocked; the real round
 * trip through `/ingest` belongs to the verify walk on a preview deploy.
 */
const THEMES = ["light", "dark"] as const;

const PROVIDER_HOSTS = /ingest|sentry\.io|posthog\.com/;

function collectProviderRequests(page: Page): string[] {
  const seen: string[] = [];

  page.on("request", (request) => {
    if (PROVIDER_HOSTS.test(request.url())) {
      seen.push(request.url());
    }
  });

  return seen;
}

async function consentCookie(page: Page) {
  const cookies = await page.context().cookies();

  return cookies.find((cookie) => cookie.name === "clienthq_consent");
}

test.describe("provider isolation (AC-22)", () => {
  for (const path of ["/", "/dashboard", "/privacy", "/portal"]) {
    test(`sends nothing to a provider from ${path}`, async ({ page }) => {
      const seen = collectProviderRequests(page);

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      expect(seen).toEqual([]);
    });
  }
});

test.describe("the consent banner (AC-17, AC-18)", () => {
  test("shows for a fresh visitor as a named region, not a dialog", async ({
    page,
  }) => {
    await page.goto("/");

    const banner = page.getByRole("region", { name: "Cookie preferences" });

    await expect(banner).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      banner.getByRole("link", { name: "privacy notice" }),
    ).toHaveAttribute("href", "/privacy");
    await expect(banner.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Decline" })).toBeVisible();
    expect(await consentCookie(page)).toBeUndefined();
  });

  test("Decline hides it in place, writes declined, and sets no PostHog cookie", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("region", { name: "Cookie preferences" })
      .getByRole("button", { name: "Decline" })
      .click();

    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);

    const cookie = await consentCookie(page);

    expect(cookie).toMatchObject({
      value: "declined",
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    expect(
      (await page.context().cookies()).filter((c) => c.name.startsWith("ph_")),
    ).toEqual([]);

    // Honoured from the cookie on the next visit: no banner, no flash.
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);
  });

  test("Accept hides it in place and writes accepted for a year", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("region", { name: "Cookie preferences" })
      .getByRole("button", { name: "Accept" })
      .click();

    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);

    const cookie = await consentCookie(page);

    expect(cookie?.value).toBe("accepted");
    // About a year from now, in seconds.
    const aYear = 60 * 60 * 24 * 365;
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + aYear - 3600);
  });

  test("Cookie settings on /privacy brings the banner back", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);

    await page.goto("/privacy");
    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Cookie settings" }).click();

    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toBeVisible();
    expect(await consentCookie(page)).toBeUndefined();
  });

  test("is reached by keyboard in document order, and never traps focus", async ({
    page,
  }) => {
    await page.goto("/privacy");

    // Tab from the top of the document to the banner's Decline button and
    // past it: focus keeps moving, so there is no trap.
    await page.keyboard.press("Tab");
    let landed = false;

    for (let i = 0; i < 40 && !landed; i += 1) {
      await page.keyboard.press("Tab");
      landed = await page.evaluate(
        () => document.activeElement?.textContent === "Decline",
      );
    }

    expect(landed).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement?.textContent),
    ).not.toBe("Decline");
  });

  test("never renders under /portal, where no analytics script exists (AC-14)", async ({
    page,
  }) => {
    const chunks: string[] = [];

    page.on("request", (request) => {
      if (/posthog/i.test(request.url())) {
        chunks.push(request.url());
      }
    });

    await page.goto("/portal");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("region", { name: "Cookie preferences" }),
    ).toHaveCount(0);
    expect(chunks).toEqual([]);
    expect(
      (await page.context().cookies()).filter((c) => c.name.startsWith("ph_")),
    ).toEqual([]);
  });

  for (const theme of THEMES) {
    test(`has no WCAG violation with the banner open, in ${theme}`, async ({
      page,
    }) => {
      await page.goto("/");
      await useTheme(page, theme);
      await page.goto("/");
      await expect(
        page.getByRole("region", { name: "Cookie preferences" }),
      ).toBeVisible();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("the privacy notice (AC-19)", () => {
  test("is public, names both collectors, the identifiers and the cookie", async ({
    page,
  }) => {
    const response = await page.goto("/privacy");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Privacy notice",
    );
    const main = page.getByRole("main");
    await expect(main).toContainText("Sentry");
    await expect(main).toContainText("PostHog");
    await expect(main).toContainText("clienthq_consent");
    await expect(main).toContainText("not profiled at all");
    await expect(main).toContainText("European Union");
    await expect(
      page.getByRole("button", { name: "Cookie settings" }),
    ).toBeVisible();
  });

  test("is linked from the sign in and sign up pages", async ({ page }) => {
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(
        page.getByRole("link", { name: "Privacy notice", exact: true }),
      ).toHaveAttribute("href", "/privacy");
    }
  });

  for (const theme of THEMES) {
    test(`has no WCAG violation in ${theme}`, async ({ page }) => {
      await page.goto("/privacy");
      await useTheme(page, theme);
      await page.goto("/privacy");

      await expectNoAccessibilityViolations(page);
    });
  }
});
