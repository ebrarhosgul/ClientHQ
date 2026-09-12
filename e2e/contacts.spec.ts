import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0009, AC-14, at real painted colour and real layout.
 *
 * This suite runs with no Clerk credentials (see `CLERK.md`), so the
 * authenticated walk (add a contact, send, accept on a second account, land on
 * `/portal`) is not here: it is the manual pass in the spec's `verify.md`, and
 * `/test` owns writing the signed in version once the suite has a way past
 * sign in. What can be proven signed out is proven here: the accept page's
 * degraded state, and every Contacts and accept page state from the gallery,
 * both of them under axe in both themes.
 */
test.describe("the accept page, with no Clerk configured", () => {
  test("explains that invitations need an account provider rather than failing", async ({
    page,
  }) => {
    await page.goto("/portal/accept?token=not.a.token");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Invitations are not configured",
      }),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme}`, async ({ page }) => {
      await page.goto("/portal/accept?token=not.a.token");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  }
});

test.describe("the Contacts section and the accept page states, in the gallery", () => {
  test("shows all five statuses in words, the empty state, and the four accept states", async ({
    page,
  }) => {
    await page.goto("/design");

    const light = page.getByRole("region", { name: "Light" });

    for (const label of [
      "Not invited",
      "Email not sent",
      "Invited until 19 September 2026 (UTC)",
      "Expired",
      "Accepted",
    ]) {
      await expect(light.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(light.getByText("No contacts yet")).toBeVisible();

    for (const heading of [
      "Accept your invitation",
      "You already accepted this invitation",
      "This invitation is for a different email address",
      "This invitation link is not valid",
    ]) {
      await expect(light.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("keeps every inline action at least 24 by 24 pixels", async ({
    page,
  }) => {
    await page.goto("/design");

    const contacts = page
      .getByRole("region", { name: "Light" })
      .getByRole("region", { name: "Contacts" })
      .first();
    const buttons = contacts.getByRole("button");
    const count = await buttons.count();

    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    }
  });
});
