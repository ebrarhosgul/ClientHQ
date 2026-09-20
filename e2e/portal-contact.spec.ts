import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * The contact path, signed in for real (spec 0014, AC-16), against the
 * dedicated server `playwright.config.ts` only starts when
 * `E2E_CLERK_CONTACT_USERNAME`, `E2E_CLERK_CONTACT_PASSWORD` and
 * `E2E_CLERK_CONTACT_USER_ID` are all set, alongside both Clerk keys.
 *
 * Priya Patel, the seeded test user, holds four accepted rows: Northstar
 * Cloud Solutions and Harbor Lane Capital, both under Apex Interactive Studio
 * (`full`), Fernwood Clinic under Harbor Lane (`grace`, one hour into its 7
 * day window) and Cinder Media under Anchor Ridge (`canceled`, so `locked`
 * unconditionally, with no clock to wait on). Northstar is her most recently
 * accepted row, so it is where she lands. The walk covers the Northstar
 * overview and its three sections, a file
 * download, the not found page on another client's ids, the switcher, and
 * the locked agency's unavailable page: everything AC-16 names except the
 * Fernwood row, which stays a `grace` fixture for the agency side (spec
 * 0008) rather than this spec's own locked scenario.
 *
 * `clerk.signIn({ emailAddress })` finds the user by email and signs them in
 * through a backend issued ticket, rather than driving the `<SignIn/>` form:
 * it needs no password and, unlike a form walk, it does not trip the "you're
 * signing in from a new device" email challenge a fresh Playwright browser
 * profile otherwise triggers every run. `setupClerkTestingToken` runs inside
 * it, so nothing here calls it separately.
 *
 * Unset, `playwright.config.ts` never defines the `portal-contact` project at
 * all, so this file reports no tests rather than a failure; the guard below
 * is a second line of defence if it is ever picked up some other way.
 */
const CONTACT_USERNAME = process.env.E2E_CLERK_CONTACT_USERNAME;
const CONTACT_PASSWORD = process.env.E2E_CLERK_CONTACT_PASSWORD;

/**
 * Harbor Lane Capital's own seeded rows (`scripts/seed-dataset.ts`'s fixed
 * ids): under the same agency as Northstar, but a different client. Priya
 * holds a row there too, yet her active row is Northstar's, and a contact
 * reads one client at a time, so they are foreign to it the same way another
 * agency's rows would be (AC-14).
 */
const FOREIGN_INVOICE_ID = "0190a000-0000-7000-8000-000900000003";
const FOREIGN_PROJECT_ID = "0190a000-0000-7000-8000-000700000003";

test.beforeEach(() => {
  test.skip(
    !CONTACT_USERNAME || !CONTACT_PASSWORD,
    "E2E_CLERK_CONTACT_USERNAME / E2E_CLERK_CONTACT_PASSWORD not set",
  );
});

async function signInAsContact(page: import("@playwright/test").Page) {
  // A not protected page that loads Clerk, per `clerk.signIn`'s own
  // requirement; `/portal` itself needs a session to reach at all.
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: CONTACT_USERNAME! });
  await page.goto("/portal");
  await page.waitForURL("**/portal");
}

test.describe("the contact path", () => {
  test("signs in and lands on the Northstar overview", async ({ page }) => {
    await signInAsContact(page);

    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  });

  test("opens the invoice list, one invoice, and its PDF", async ({ page }) => {
    await signInAsContact(page);

    await page
      .getByRole("region", { name: "Invoices" })
      .getByRole("link", { name: "See all" })
      .click();
    await page.waitForURL("**/portal/invoices");

    const invoiceLink = page.getByRole("link", { name: "INV-0001" });
    await expect(invoiceLink).toBeVisible();
    await invoiceLink.click();
    await page.waitForURL("**/portal/invoices/*");

    const pdfLink = page.getByRole("link", { name: /Download PDF/ });
    const [pdfResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes("/pdf") &&
          response.request().method() === "GET",
      ),
      pdfLink.click(),
    ]);

    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
  });
});

test.describe("projects and files", () => {
  test("opens the projects list, a project, and downloads its shared file", async ({
    page,
  }) => {
    await signInAsContact(page);

    await page.getByRole("link", { name: "Projects" }).click();
    await page.waitForURL("**/portal/projects");

    const projectLink = page.getByRole("link", {
      name: "Design System v2 Migration",
    });
    await expect(projectLink).toBeVisible();
    await projectLink.click();
    await page.waitForURL("**/portal/projects/*");

    const fileLink = page.getByRole("link", {
      name: "design-tokens-v2.1.json",
    });
    await expect(fileLink).toBeVisible();

    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url().includes("/deliverables/") &&
          candidate.url().includes("/download"),
      ),
      fileLink.click(),
    ]);

    // The route resolves the file as Priya's own and shared (a `302` to the
    // signed URL), or, if this seed's dev R2 bucket has no real object for it
    // (only the row was seeded, not the bytes), the route's own "missing
    // object" page: a `404` naming the file, which the link's real navigation
    // lands the tab on. Either is proof the tenancy and visibility checks
    // passed; only the portal's own not found page (different copy) would
    // mean they did not.
    expect([302, 404]).toContain(response.status());
    if (response.status() === 404) {
      await expect(page.getByText("This file is missing")).toBeVisible();
    }
  });
});

test.describe("the tenancy walk (spec 0014, AC-12, AC-14)", () => {
  test("answers not found for another client's invoice id", async ({
    page,
  }) => {
    await signInAsContact(page);

    const response = await page.goto(`/portal/invoices/${FOREIGN_INVOICE_ID}`);

    // Next 16 answers `200` for a `notFound()` thrown from a streamed page
    // (its own docs, `not-found.md`: "200 for streamed responses, 404 for
    // non-streamed"), so the real page.tsx never streams a status this route
    // could assert; the not found *content*, inside the portal chrome with
    // the switcher and section strip still there, is the actual proof.
    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page is not available")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to your portal" }),
    ).toBeVisible();
  });

  test("answers not found for another client's project id", async ({
    page,
  }) => {
    await signInAsContact(page);

    const response = await page.goto(`/portal/projects/${FOREIGN_PROJECT_ID}`);

    // See the invoice case above: `200` is Next 16's own documented answer
    // for a `notFound()` thrown from a streamed page.
    expect(response?.status()).toBe(200);
    await expect(page.getByText("This page is not available")).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation on the not found shape in ${theme} (AC-15)`, async ({
      page,
    }) => {
      await signInAsContact(page);
      await page.goto(`/portal/invoices/${FOREIGN_INVOICE_ID}`);
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("the switcher and the locked walk (spec 0014, AC-3, AC-11, AC-13)", () => {
  test("switches to the locked agency and lands on the unavailable page", async ({
    page,
  }) => {
    await signInAsContact(page);

    await page.getByRole("button", { name: /Switch client/ }).click();
    await page.getByRole("menuitem", { name: /Cinder Media/ }).click();
    await page.waitForURL("**/portal/unavailable");

    await expect(
      page.getByRole("heading", {
        name: "This portal is not available right now",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Anchor Ridge's ClientHQ account needs attention before the portal can be shown. Contact Anchor Ridge if you need something in the meantime.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("switches back to a readable client from the unavailable page's own menu", async ({
    page,
  }) => {
    await signInAsContact(page);

    await page.getByRole("button", { name: /Switch client/ }).click();
    await page.getByRole("menuitem", { name: /Cinder Media/ }).click();
    await page.waitForURL("**/portal/unavailable");

    await page.getByRole("button", { name: /Switch client/ }).click();
    await page.getByRole("menuitem", { name: /Northstar/ }).click();
    await page.waitForURL("**/portal");

    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  });

  test("opens and closes the switcher from the keyboard alone, returning focus to it", async ({
    page,
  }) => {
    await signInAsContact(page);

    const trigger = page.getByRole("button", { name: /Switch client/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: /Cinder Media/ }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation on the unavailable page in ${theme}`, async ({
      page,
    }) => {
      await signInAsContact(page);
      await page.getByRole("button", { name: /Switch client/ }).click();
      await page.getByRole("menuitem", { name: /Cinder Media/ }).click();
      await page.waitForURL("**/portal/unavailable");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("320 pixels (spec 0014, AC-4, AC-15)", () => {
  const PORTAL_ROUTES = [
    "/portal",
    "/portal/projects",
    "/portal/files",
    "/portal/invoices",
  ] as const;

  for (const route of PORTAL_ROUTES) {
    test(`never asks anyone to scroll in two directions on ${route}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await signInAsContact(page);
      if (route !== "/portal") {
        await page.goto(route);
      }

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      expect(overflows).toBe(false);
    });
  }

  test("keeps the three section links visible at 320 pixels, with no menu button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await signInAsContact(page);

    const nav = page.getByRole("navigation", { name: "Portal sections" });
    await expect(nav.getByRole("link", { name: "Projects" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Files" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Menu$/ })).toHaveCount(0);
  });
});
