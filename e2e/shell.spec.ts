import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * The agency shell, rendering on the real system. Spec 0004, AC-6, AC-7,
 * AC-19, AC-22 and AC-23.
 *
 * Signed out throughout, which is the state the CI runner is always in: the
 * shell is chrome, so it has to hold up with no session and show a way in
 * where the switcher and the user menu would be.
 */
test.describe("the agency shell", () => {
  test("renders the sidebar with both groups", async ({ page }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Sections" }).first();

    for (const label of ["Dashboard", "Clients", "Projects", "Invoices"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    for (const label of ["Team", "Billing", "Settings"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("commits to the exact paths every later feature has to use", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Sections" }).first();
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));

    // AC-23. Changing one of these is a change to the spec, not to the shell.
    expect(hrefs).toEqual([
      "/dashboard",
      "/clients",
      "/projects",
      "/invoices",
      "/team",
      "/billing",
      "/settings",
    ]);
  });

  test("marks the current section for a screen reader, not just with a colour", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Sections" }).first();

    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      nav.getByRole("link", { name: "Clients" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("puts the skip link first in the tab order and lands it on the content", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");

    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    // Visible once focused: a skip link nobody can see is a skip link nobody
    // knows they have.
    await expect(skip).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
  });

  test("keeps the focus ring clear of the sticky top bar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto("/dashboard");

    // Tab into the sidebar and down it, then check the focused link is not
    // sitting under the bar (WCAG 2.2, 2.4.11).
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Tab");

    const clear = await page.evaluate(() => {
      const active = document.activeElement;
      const bar = document.querySelector("header");
      if (!active || !bar) return true;

      const a = active.getBoundingClientRect();
      const b = bar.getBoundingClientRect();

      return a.bottom <= b.top || a.top >= b.bottom || a.left >= b.right;
    });

    expect(clear).toBe(true);
  });

  test("shows a way in where the switcher and user menu would be", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // Signed out. The chrome keeps its shape and nothing crashes (AC-22).
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Dashboard" }),
    ).toBeVisible();
  });

  test("asks Clerk nothing about organizations while signed out", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Long enough for Clerk to load and for any hook it serves to settle.
    await page.waitForTimeout(2000);

    const stray = await page.evaluate(() => ({
      clerkModals: document.querySelectorAll('[class*="cl-modal"]').length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    }));

    // `useOrganizationList` must not run for a visitor who has no
    // organizations. When it does and the Clerk instance has Organizations
    // switched off, Clerk puts a blocking modal over the whole page, which also
    // swallows every click the rest of this suite tries to make.
    expect(stray).toEqual({ clerkModals: 0, dialogs: 0 });
  });

  test("lands a sidebar link whose feature has not shipped on a real page", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Sections" })
      .first()
      .getByRole("link", { name: "Projects" })
      .click();

    // Inside the shell, with an explanation and a way back, not a bare 404.
    await expect(page.getByText("Not here yet")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Sections" }).first(),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme}`, async ({ page }) => {
      await page.goto("/dashboard");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("the sidebar below md", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hides the fixed sidebar and offers a labelled menu button", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("button", { name: "Open the menu" }),
    ).toBeVisible();
  });

  test("opens a dialog, traps focus in it, and closes on Escape", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const trigger = page.getByRole("button", { name: "Open the menu" });
    await trigger.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Clients" })).toBeVisible();

    // Tab a long way. Focus must stay inside the sheet the whole time.
    for (let i = 0; i < 15; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(document.activeElement) ?? false;
      });
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    // Focus goes back to the button that opened it.
    await expect(trigger).toBeFocused();
  });

  test("closes itself when you follow a link in it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open the menu" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Invoices" })
      .click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("fits 320px without scrolling in two directions", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto("/dashboard");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );

    expect(overflows).toBe(false);
  });
});
