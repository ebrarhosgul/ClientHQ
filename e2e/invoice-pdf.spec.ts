import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0013. This suite runs with no Clerk credentials (see `CLERK.md`), so
 * the authenticated download itself (a real staff or contact session
 * fetching a real PDF) is not here: it is the manual pass in the spec's
 * `verify.md`, alongside the Vercel preview deployment build task 1 needs.
 * What can be proven signed out is proven here: with no Clerk key, no session
 * can ever resolve, so both PDF routes answer the app's ordinary 404 page for
 * any id, the same as a nonexistent one (spec 0004, AC-22); plus the frozen
 * document's new address block and Download PDF link, under axe in both
 * themes, from the gallery.
 */
test.describe("the invoice PDF routes, with no Clerk configured", () => {
  test("answers the app's 404 for the staff route", async ({ page }) => {
    const response = await page.goto(
      "/invoices/0198a000-0000-7000-8000-000000000000/pdf",
    );

    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("answers the app's 404 for the portal route", async ({ page }) => {
    const response = await page.goto(
      "/portal/invoices/0198a000-0000-7000-8000-000000000000/pdf",
    );

    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("answers the same 404 for a non uuid id, before any id is even parsed as one", async ({
    page,
  }) => {
    const response = await page.goto("/invoices/not-a-uuid/pdf");

    expect(response?.status()).toBe(404);
  });

  test("has no WCAG violation on the 404 page itself", async ({ page }) => {
    await page.goto("/invoices/0198a000-0000-7000-8000-000000000000/pdf");

    await expectNoAccessibilityViolations(page);
  });
});

test.describe("the frozen document's address block and Download PDF link, in the gallery", () => {
  test("shows the billing address on both fixtures, and the Download PDF link on the paid one only", async ({
    page,
  }) => {
    await page.goto("/design");

    const light = page.getByRole("region", { name: "Light" });

    // The address is independent of status (AC-4): both the paid and the
    // void fixture carry the same client, so it appears twice.
    await expect(light.getByText("220 Pike St")).toHaveCount(2);
    await expect(light.getByText("Seattle, WA, 98101")).toHaveCount(2);

    const link = light.getByRole("link", { name: /^Download PDF/ });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute(
      "href",
      /\/invoices\/gallery-invoice\/pdf$/,
    );
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation on the frozen document in ${theme}`, async ({
      page,
    }) => {
      await page.goto("/design");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page, {
        include: `[data-theme="${theme}"] section[aria-labelledby*="invoices"]`,
      });
    });
  }
});
