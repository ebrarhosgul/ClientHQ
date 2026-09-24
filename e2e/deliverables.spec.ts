import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0011. This suite runs with no Clerk credentials and no R2 credentials
 * (see `CLERK.md`), so the authenticated walk (pick a file, watch it upload,
 * confirm, toggle, delete) is not here: it is the manual pass in the spec's
 * `verify.md`. What can be proven signed out is proven here: the download
 * route's degraded states, which need no session at all to reach, and every
 * Deliverables state from the gallery, under axe in both themes.
 */
test.describe("the download route, with no R2 configured", () => {
  test("answers the storage not configured page rather than crashing", async ({
    page,
  }) => {
    const response = await page.goto(
      "/deliverables/0198a000-0000-7000-8000-000000000000/download",
    );

    expect(response?.status()).toBe(503);
    await expect(
      page.getByText("File storage is not configured"),
    ).toBeVisible();
    await expect(
      page.getByText("Downloads are unavailable in this environment."),
    ).toBeVisible();
  });

  test("answers a non uuid id the same way, before any id is even parsed as one", async ({
    page,
  }) => {
    const response = await page.goto("/deliverables/not-a-uuid/download");

    expect(response?.status()).toBe(503);
  });
});

test.describe("the Deliverables section states, in the gallery", () => {
  test("shows the list, the empty state, and the not configured notice", async ({
    page,
  }) => {
    await page.goto("/design");

    // Exact: substring matching would also pick up the dashboard summary's
    // "Recent deliverables" section added alongside this one (spec 0020).
    const light = page
      .getByRole("region", { name: "Light" })
      .getByRole("region", { name: "Deliverables", exact: true });

    await expect(light.getByText("Logo pack.zip")).toBeVisible();
    await expect(light.getByText("ZIP", { exact: true })).toBeVisible();
    await expect(light.getByText("No deliverables yet")).toBeVisible();
    await expect(
      light.getByText("Deliverables could not be loaded"),
    ).toBeVisible();
    await expect(
      light.getByText("File storage is not configured for this environment."),
    ).toBeVisible();
    await expect(
      light.getByRole("switch", { name: /Visible to client: Logo pack\.zip/ }),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation on the section alone, in ${theme}`, async ({
      page,
    }) => {
      await page.goto("/design");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page, {
        include: `[data-theme="${theme}"] section[aria-labelledby*="deliverables"]`,
      });
    });
  }
});
