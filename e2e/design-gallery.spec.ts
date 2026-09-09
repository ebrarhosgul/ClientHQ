import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * The gallery, which is what makes this feature checkable at all.
 *
 * `/design` renders every primitive and pattern twice, once per palette, so a
 * single axe run here covers both themes on real painted colour. The table
 * checks below are the ones jsdom cannot do: column priority at a real
 * viewport width, and target size as actually laid out.
 */
test.describe("the design gallery", () => {
  test("renders both palettes on one page", async ({ page }) => {
    await page.goto("/design");

    await expect(
      page.getByRole("heading", { level: 2, name: "Light" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Dark" }),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation with the page itself in ${theme}`, async ({
      page,
    }) => {
      await page.goto("/design");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }

  test("gives every control a visible focus ring", async ({ page }) => {
    await page.goto("/design");

    const widths = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");

      const width = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return undefined;
        if (active.tagName === "NEXTJS-PORTAL") return undefined;
        return getComputedStyle(active).outlineWidth;
      });

      if (!width) break;
      widths.add(width);
    }

    // One ring, one width, everywhere.
    expect([...widths]).toEqual(["2px"]);
  });
});

test.describe("the table, at the width that matters", () => {
  test("keeps the low priority columns above md", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/design");

    const table = page.getByRole("table").first();

    await expect(
      table.getByRole("columnheader", { name: "Issued" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Created by" }),
    ).toBeVisible();
  });

  test("removes them from the layout and the accessibility tree below md", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/design");

    const table = page.getByRole("table").first();

    // `hidden` is `display: none`, so these are gone from the accessibility
    // tree as well as the layout. A screen reader on a phone is not read six
    // columns that nobody can see.
    await expect(
      table.getByRole("columnheader", { name: "Issued" }),
    ).toHaveCount(0);
    await expect(
      table.getByRole("columnheader", { name: "Created by" }),
    ).toHaveCount(0);

    await expect(
      table.getByRole("columnheader", { name: "Invoice" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Status" }),
    ).toBeVisible();
  });

  test("never asks anyone to scroll in two directions at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/design");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );

    expect(overflows).toBe(false);
  });

  test("makes the row clickable without swallowing its action buttons", async ({
    page,
  }) => {
    await page.goto("/design");

    const table = page.getByRole("table").first();
    const row = table.getByRole("row").filter({ hasText: "INV-2026-0041" });

    // One link for the row, and each action its own separately named control.
    // A row wrapped in an anchor would give one nested, unusable stop instead.
    await expect(
      row.getByRole("link", { name: "INV-2026-0041" }),
    ).toHaveAttribute("href", "/invoices/1");
    await expect(
      row.getByRole("button", { name: "Edit INV-2026-0041" }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Archive INV-2026-0041" }),
    ).toBeVisible();
  });

  test("keeps every inline action at or above the 24 pixel minimum", async ({
    page,
  }) => {
    await page.goto("/design");

    const table = page.getByRole("table").first();
    const actions = table.getByRole("button");
    const count = await actions.count();

    expect(count).toBeGreaterThan(0);

    // WCAG 2.2, 2.5.8, checked on the densest surface in the product.
    for (let i = 0; i < count; i += 1) {
      const box = await actions.nth(i).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    }
  });
});
