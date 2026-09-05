import { expect, test } from "@playwright/test";

/**
 * The scaffold, walked in a real browser.
 *
 * Spec 0001's "done when" for this feature is that the scaffold boots, serves a
 * page, and can reach the database. These specs check exactly that and no more.
 * The page is a placeholder feature 5 replaces, so the assertions stay on
 * structure and on the health route's contract, both of which outlive the
 * current wording.
 */

test.describe("the entry page", () => {
  test("serves the entry page with the product name in the tab title", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/ClientHQ/);
  });

  test("shows one first level heading naming the product", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "ClientHQ",
    );
  });

  test("renders inside a main landmark", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("main")).toBeVisible();
  });

  test("serves its stylesheet, so the page is styled and not raw markup", async ({
    page,
  }) => {
    await page.goto("/");

    // Deliberately not a check on a particular weight or colour: the visual
    // direction is feature 5's to settle. What has to hold today is that the
    // Tailwind pipeline runs at all and the font variables reach the document.
    const styling = await page.evaluate(() => ({
      sheets: document.styleSheets.length,
      fontVariable: getComputedStyle(document.documentElement).getPropertyValue(
        "--font-geist-sans",
      ),
    }));

    expect(styling.sheets).toBeGreaterThan(0);
    expect(styling.fontVariable.trim()).not.toBe("");
  });

  test("reports no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("fits a 375px viewport without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );

    expect(overflows).toBe(false);
  });

  test("fits a 1280px viewport without sideways scrolling", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );

    expect(overflows).toBe(false);
  });

  test("reaches the health check from the link on the page", async ({
    page,
  }) => {
    await page.goto("/");

    // Wait on the navigation the click starts, rather than on the click alone:
    // otherwise the URL is read before the browser has committed the new page.
    await Promise.all([
      page.waitForURL(/\/api\/health\/db$/),
      page.getByRole("link", { name: "/api/health/db" }).click(),
    ]);

    await expect(page).toHaveURL(/\/api\/health\/db$/);
  });
});

test.describe("the database health route", () => {
  test("answers with JSON, either reachable or unreachable", async ({
    request,
  }) => {
    const response = await request.get("/api/health/db");
    const body = await response.json();

    // Green either way: with credentials present it is 200, without them 503.
    // What is being checked is that the route runs and answers in one shape.
    expect([200, 503]).toContain(response.status());
    expect(body.status).toMatch(/^(ok|error)$/);
    expect(body.database).toMatch(/^(reachable|unreachable)$/);
  });

  test("agrees with itself: 200 means reachable, 503 means unreachable", async ({
    request,
  }) => {
    const response = await request.get("/api/health/db");
    const body = await response.json();

    if (response.status() === 200) {
      expect(body).toMatchObject({ status: "ok", database: "reachable" });
      expect(typeof body.roundTripMs).toBe("number");
    } else {
      expect(body).toEqual({ status: "error", database: "unreachable" });
    }
  });

  test("never returns connection details to an unauthenticated caller", async ({
    request,
  }) => {
    const response = await request.get("/api/health/db");
    const raw = await response.text();

    // The route is open to anyone. A failure must not describe the database.
    expect(raw).not.toMatch(/postgres:\/\//);
    expect(raw).not.toMatch(/supabase\.(com|co)/i);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/);
  });

  test("runs on every request rather than answering from a cache", async ({
    request,
  }) => {
    // What `force-dynamic` and `revalidate = 0` promise: the handler executes
    // each time. A health check served from a snapshot would report the state of
    // the world at build time.
    const first = await request.get("/api/health/db");
    const second = await request.get("/api/health/db");

    expect(first.headers()["x-nextjs-cache"] ?? "").not.toBe("HIT");
    expect(second.headers()["x-nextjs-cache"] ?? "").not.toBe("HIT");
    for (const response of [first, second]) {
      const body = await response.json();
      if (response.status() === 200) {
        expect(typeof body.roundTripMs).toBe("number");
      }
    }
  });
});
