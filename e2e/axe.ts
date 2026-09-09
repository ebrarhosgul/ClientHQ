import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * axe against the real application. Spec 0004, AC-19.
 *
 * Same rule tags as the Vitest helper in `src/ui/test/axe.ts`. This run is the
 * one that can see colour and layout, so it catches the two things jsdom
 * cannot: contrast as actually painted, and target size as actually laid out.
 */
export const WCAG_RULE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

export type ThemeName = "light" | "dark";

/**
 * Put the page in one theme.
 *
 * The theme is a server read cookie, so it is set on the context rather than
 * toggled in the browser: that exercises the real path, including the fact that
 * the correct palette is painted in the first frame with no flash (AC-8).
 */
export async function useTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.context().addCookies([
    {
      name: "clienthq_theme",
      value: theme,
      url: page.url().startsWith("http")
        ? new URL(page.url()).origin
        : "http://localhost:3100",
    },
  ]);
}

export async function expectNoAccessibilityViolations(
  page: Page,
  options: { readonly include?: string } = {},
): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags([...WCAG_RULE_TAGS]);
  const results = await (
    options.include ? builder.include(options.include) : builder
  ).analyze();

  expect(
    results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}
