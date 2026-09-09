import { expect, test } from "@playwright/test";

/**
 * The parts of AC-20 a browser can actually prove.
 *
 * Zoom and reflow are the checks spec 0004 expects to be hardest, because the
 * density is deliberately compact. They are here rather than only in the manual
 * pass so that a later feature which adds a wide table finds out on the push
 * rather than in an audit. Everything a machine cannot see (a screen reader,
 * "help is in the same place on every page") stays manual in `verify.md`.
 */
const ROUTES = ["/", "/dashboard", "/design"] as const;

for (const route of ROUTES) {
  test.describe(route, () => {
    test("reflows into one column at 400 percent zoom", async ({ page }) => {
      // WCAG 1.4.10: 400 percent at 1280 wide is equivalent to a 320px
      // viewport, which is the width the success criterion actually names.
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(route);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      expect(overflows).toBe(false);
    });

    test("loses nothing at 200 percent zoom", async ({ page }) => {
      // 200 percent on a 1280 wide window is a 640 wide layout viewport.
      await page.setViewportSize({ width: 640, height: 512 });
      await page.goto(route);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      expect(overflows).toBe(false);
    });

    test("keeps body copy at a readable size on a phone", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);

      const tooSmall = await page.evaluate(() => {
        const offenders: string[] = [];

        for (const element of Array.from(
          document.querySelectorAll("p, li, td, th"),
        )) {
          const text = element.textContent?.trim() ?? "";
          if (text.length < 20) continue;
          if (element.closest("[hidden]")) continue;

          const size = Number.parseFloat(getComputedStyle(element).fontSize);
          // 12px is the metadata tier and is deliberate. Anything under it is
          // not a size choice, it is a mistake.
          if (size < 12) offenders.push(`${element.tagName} ${size}px`);
        }

        return offenders;
      });

      expect(tooSmall).toEqual([]);
    });
  });
}

test.describe("reduced motion", () => {
  test("switches every transition and animation off", async ({ page }) => {
    // Set on the page rather than through `test.use`, which does not reach a
    // page the fixture has already created.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");

    expect(
      await page.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const moving = await page.evaluate(() => {
      const offenders: string[] = [];

      for (const element of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(element);
        const durations = [style.transitionDuration, style.animationDuration]
          .join(",")
          .split(",")
          .map((value) => Number.parseFloat(value) || 0);

        // The global rule collapses everything to 0.01ms. Anything still
        // measured in tenths of a second slipped past it.
        if (durations.some((seconds) => seconds > 0.001)) {
          offenders.push(
            `${element.tagName}.${element.className.toString().slice(0, 40)}`,
          );
        }
      }

      return offenders.slice(0, 5);
    });

    expect(moving).toEqual([]);
  });

  test("still shows the skeleton, which never depended on the pulse", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/design");

    // A still grey block still reads as "not here yet", so switching the pulse
    // off costs nothing. What announces the state is the region, in words.
    const region = page.getByRole("status").first();
    await expect(region).toBeAttached();
    await expect(region).toContainText("Loading invoices");
  });
});
