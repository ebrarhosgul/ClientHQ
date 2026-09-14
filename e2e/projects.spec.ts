import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0010, AC-4, AC-17, and the degraded path spec 0004's AC-22 requires:
 * this suite runs with no Clerk credentials (see `CLERK.md`), so every route
 * here is the signed out shape, not the authenticated create, edit, archive
 * or transition flow -- that half is covered by the component tests beside
 * each page, and by the manual pass in
 * `docs/specs/0010-projects/verify.md`.
 *
 * The `feat/projects` review (2026-09-13) flagged that no e2e spec targeted
 * `/projects` at all, unlike `clients.spec.ts` and `contacts.spec.ts`; this
 * file is that spec.
 */
test.describe("the project list, signed out", () => {
  test("shows the empty state rather than a query with no session", async ({
    page,
  }) => {
    await page.goto("/projects");

    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme} (AC-17)`, async ({ page }) => {
      await page.goto("/projects");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("creating a project, signed out", () => {
  test("asks for sign in instead of showing a form that could only ever fail (spec 0004, AC-22)", async ({
    page,
  }) => {
    await page.goto("/projects/new");

    await expect(page.getByText("Sign in to create a project")).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Project name" }),
    ).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme} (AC-17)`, async ({ page }) => {
      await page.goto("/projects/new");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("a single project, signed out", () => {
  test("resolves not found rather than a permission error or a blank page (AC-15)", async ({
    page,
  }) => {
    await page.goto("/projects/some-project-id");

    await expect(page.getByText("Not here yet")).toBeVisible();
  });

  test("resolves not found on the edit route too", async ({ page }) => {
    await page.goto("/projects/some-project-id/edit");

    await expect(page.getByText("Not here yet")).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation on the not found shape in ${theme}`, async ({
      page,
    }) => {
      await page.goto("/projects/some-project-id");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});
