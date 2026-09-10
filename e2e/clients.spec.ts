import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0006, AC-13 and the degraded path spec 0004's AC-22 requires: this
 * suite runs with no Clerk credentials (see `CLERK.md`), so every route here
 * is the signed out shape, not the authenticated create/edit/archive flow --
 * that half is covered by the component tests beside each page, and by the
 * manual pass in `docs/specs/0006-client-records/verify.md`.
 *
 * `verify.md` flags that no e2e spec targeted `/clients` at all; this file is
 * that spec.
 */
test.describe("the client list, signed out", () => {
  test("shows the empty state rather than a query with no session", async ({
    page,
  }) => {
    await page.goto("/clients");

    await expect(
      page.getByRole("heading", { level: 1, name: "Clients" }),
    ).toBeVisible();
    await expect(page.getByText("No clients yet")).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme} (AC-13)`, async ({ page }) => {
      await page.goto("/clients");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("creating a client, signed out", () => {
  test("asks for sign in instead of showing a form that could only ever fail (spec 0004, AC-22)", async ({
    page,
  }) => {
    await page.goto("/clients/new");

    await expect(page.getByText("Sign in to create a client")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Client name" }),
    ).toHaveCount(0);
  });
});

test.describe("a single client, signed out", () => {
  test("resolves not found rather than a permission error or a blank page (AC-11)", async ({
    page,
  }) => {
    await page.goto("/clients/some-client-id");

    await expect(page.getByText("Not here yet")).toBeVisible();
  });

  test("resolves not found on the edit route too", async ({ page }) => {
    await page.goto("/clients/some-client-id/edit");

    await expect(page.getByText("Not here yet")).toBeVisible();
  });
});
