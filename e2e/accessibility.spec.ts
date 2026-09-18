import { expect, test, type Page } from "@playwright/test";

import { expectNoAccessibilityViolations, useTheme } from "./axe";

/**
 * axe against the real rendered application, in both themes. Spec 0004, AC-19.
 *
 * This is the half of the accessibility proof jsdom cannot give: colour as
 * actually painted, and layout as actually laid out. `src/ui/test/axe.ts` uses
 * the same rule tags on the component level, and the two together are still not
 * the whole of AC-20, which is a person with a keyboard and a screen reader.
 *
 * Routes are added here as each one lands: `/` in milestone 1, `/design` in
 * milestone 2, `/dashboard` in milestone 4.
 */
const THEMES = ["light", "dark"] as const;

/**
 * The `L` of the resolved `--background` token, between 0 and 1.
 *
 * Reading the token rather than the painted colour keeps these tests about
 * which CSS block won, not about the exact shade the palette currently holds.
 */
async function lightnessOfPageBackground(page: Page): Promise<number> {
  const value = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--background")
      .trim(),
  );

  // The stylesheet says `oklch()`; Chromium hands the computed value back as
  // `lab()` with L as a percentage. Accept either and normalise to 0 to 1.
  const match = value.match(/(?:oklch|oklab|lab)\(\s*([\d.]+)(%?)/);

  if (!match) {
    throw new Error(
      `--background is not a colour this test can read: "${value}"`,
    );
  }

  const lightness = Number(match[1]);

  return match[2] === "%" || lightness > 1.5 ? lightness / 100 : lightness;
}

for (const theme of THEMES) {
  test.describe(`the ${theme} theme`, () => {
    test("serves / with no WCAG violation", async ({ page }) => {
      await page.goto("/");
      await useTheme(page, theme);
      await page.reload();

      await expectNoAccessibilityViolations(page);
    });
  });
}

test.describe("the theme, decided on the server", () => {
  test("paints the stored theme in the first frame, with no flash", async ({
    page,
  }) => {
    await page.goto("/");
    await useTheme(page, "dark");

    // Read the attribute out of the HTML the server sent, before any script has
    // had a chance to run. A client side theme picker cannot pass this.
    const response = await page.request.get("/");

    expect(await response.text()).toMatch(/<html[^>]*data-theme="dark"/);
  });

  test("stamps nothing when no choice is stored", async ({ page }) => {
    await page.context().clearCookies();
    const response = await page.request.get("/");

    // No attribute means the `prefers-color-scheme` block decides, which is
    // what lets a change to the operating system setting land with no reload.
    expect(await response.text()).not.toMatch(/<html[^>]*data-theme=/);
  });

  test("follows the operating system preference with no stored choice", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();

    try {
      await page.goto("/");

      const isDark = await page.evaluate(
        () => window.matchMedia("(prefers-color-scheme: dark)").matches,
      );

      expect(isDark).toBe(true);
      expect(await lightnessOfPageBackground(page)).toBeLessThan(0.5);
    } finally {
      await context.close();
    }
  });

  test("lets an explicit light choice beat a dark operating system", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();

    try {
      await page.goto("/");
      await context.addCookies([
        {
          name: "clienthq_theme",
          value: "light",
          url: "http://localhost:3100",
        },
      ]);
      await page.reload();

      // The guard on the media block is what makes this work in both
      // directions: without it the operating system would win here.
      expect(await lightnessOfPageBackground(page)).toBeGreaterThan(0.9);
    } finally {
      await context.close();
    }
  });

  test("remembers the choice across a fresh page load", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.goto("/");

    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("the entry page", () => {
  test("offers the two ways in that feature 6 has to build", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    await expect(
      page.getByRole("link", { name: "Create an agency" }),
    ).toHaveAttribute("href", "/sign-up");
  });

  test("shows the one declared focus ring on every stop", async ({ page }) => {
    await page.goto("/");

    const stops: { name: string; width: string; style: string }[] = [];

    // Tab until focus leaves the document rather than a fixed number of times,
    // so adding a control to the page extends the check instead of breaking it.
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press("Tab");

      const stop = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return undefined;
        // The dev server injects its own error overlay at the end of the tab
        // order. It is not part of the product and is absent in a build.
        if (active.tagName === "NEXTJS-PORTAL") return undefined;

        const style = getComputedStyle(active);
        return {
          name: `${active.tagName}.${active.className.toString().split(" ")[0]}`,
          width: style.outlineWidth,
          style: style.outlineStyle,
        };
      });

      if (!stop) break;
      stops.push(stop);
    }

    // Eight controls: three theme buttons, the two ways in, then the consent
    // banner's privacy link and its two buttons (spec 0019, AC-18), last in
    // document order because the banner is a landmark, not a dialog.
    expect(stops).toHaveLength(8);

    // A stop with no ring is somewhere a keyboard user is lost. globals.css
    // declares exactly one, unlayered, so no component can weaken it.
    for (const stop of stops) {
      expect(stop, `${stop.name} paints no focus ring`).toMatchObject({
        width: "2px",
        style: "solid",
      });
    }
  });

  test("paints the focus ring in the ring colour, not the text colour", async ({
    page,
  }) => {
    await page.goto("/");

    // Four stops in: the primary Sign in button, whose text is near white.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("Tab");

    const { ring, outline } = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      return {
        ring: getComputedStyle(document.documentElement)
          .getPropertyValue("--ring")
          .trim(),
        outline: getComputedStyle(active).outlineColor,
      };
    });

    // A ring painted in `currentColor` would be invisible against the button it
    // is meant to outline. That is what the `outline` shorthand plus a `var()`
    // produces in Chromium, which is why globals.css uses the longhands.
    const normalise = (colour: string) => colour.replace(/[\s%]/g, "");

    expect(normalise(outline)).toBe(normalise(ring));
  });
});
