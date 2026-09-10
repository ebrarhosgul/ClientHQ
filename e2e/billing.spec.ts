import { expect, test } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * Spec 0007, AC-1, AC-13 and AC-19, in the shape this suite can reach.
 *
 * The suite runs with no Clerk credentials (see `CLERK.md`), so `/billing`
 * renders the state a brand new agency sees and shows no action buttons, which
 * is exactly the pair worth pinning here: the page a signed out visitor gets
 * must not be a crash, and it must not offer a control that could only ever
 * fail.
 *
 * What this cannot reach is the authenticated half: trialing, active, past due
 * and cancelled all need a real session and a real Stripe subscription. Those
 * are in `verify.md` beside spec 0007, and they are what `/check verify` runs
 * once the Stripe dashboard is set up.
 *
 * Notably, `/billing` renders here with **no Stripe environment variables set
 * at all**, which is the same claim AC-17 makes: the page reads the local
 * mirror and never calls Stripe.
 */
test.describe("the billing page, signed out", () => {
  test("shows the no subscription state rather than a query with no session", async ({
    page,
  }) => {
    await page.goto("/billing");

    await expect(
      page.getByRole("heading", { level: 1, name: "Billing" }),
    ).toBeVisible();
    await expect(page.getByText("No subscription")).toBeVisible();
    await expect(
      page.getByText("Your agency is not subscribed yet"),
    ).toBeVisible();
  });

  test("offers no action to someone who cannot take one (AC-13)", async ({
    page,
  }) => {
    await page.goto("/billing");

    await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Manage billing" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Only an admin of this agency can change the subscription",
      ),
    ).toBeVisible();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`has no WCAG violation in ${theme} (AC-19)`, async ({ page }) => {
      await page.goto("/billing");
      await useTheme(page, theme);
      await page.reload();

      // Wait for the card, not just the page. `loading.tsx` renders a skeleton
      // of the same shape in the same place, and axe is perfectly happy with a
      // skeleton, so without this the check could pass having measured nothing
      // the agency actually reads.
      await expect(page.getByText("No subscription")).toBeVisible();

      await expectNoAccessibilityViolations(page);
    });
  }

  test("announces the wait in words while the subscription is being read (AC-19)", async ({
    page,
  }) => {
    // The skeleton itself is a state this page can render, so it is a state
    // that has to be accessible. What carries the meaning is the region's
    // label; the grey shapes inside it are hidden from assistive technology.
    await page.route("**/billing", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await page.goto("/billing", { waitUntil: "commit" });

    const waiting = page.getByRole("status");

    await expect(waiting).toHaveAttribute("aria-busy", "true");
    await expect(waiting).toContainText("Loading your subscription");
  });
});
