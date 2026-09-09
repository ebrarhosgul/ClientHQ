/**
 * axe in Vitest. Spec 0004, AC-19.
 *
 * The engine is driven directly rather than through a wrapper package: the
 * wrappers rot, and the only thing they save is the twenty lines below.
 *
 * `WCAG_RULE_TAGS` is shared with the Playwright suite in `e2e/axe.ts`, so both
 * runs check the same rules. Two suites configured differently is the failure
 * mode this is meant to prevent: green in one runner and quietly unchecked in
 * the other.
 *
 * What this cannot see: jsdom computes no layout and no colour, so the
 * `color-contrast` and target size rules never run here. `src/ui/contrast.ts`
 * covers colour from the token values, and the Playwright suite covers both in
 * a real browser. Neither replaces the manual pass in `verify.md`.
 */
import axe, {
  type ElementContext,
  type Result,
  type RunOptions,
} from "axe-core";

import { type StoredTheme } from "@/ui/theme";

/** The rule set both runners use. WCAG 2.2 AA and everything it builds on. */
export const WCAG_RULE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

export const AXE_RUN_OPTIONS: RunOptions = {
  runOnly: { type: "tag", values: [...WCAG_RULE_TAGS] },
  // Best practice rules are not WCAG. Leaving them on turns a real failure
  // into noise nobody reads.
  resultTypes: ["violations"],
  rules: {
    // jsdom paints nothing, so axe reaches for a canvas that is not there and
    // logs a "not implemented" for every run. `src/ui/contrast.test.ts`
    // measures colour from the token declarations and the Playwright suite
    // measures it as painted, so nothing is lost by switching it off here.
    "color-contrast": { enabled: false },
  },
};

export async function findAccessibilityViolations(
  context: ElementContext,
): Promise<readonly Result[]> {
  const { violations } = await axe.run(context, AXE_RUN_OPTIONS);

  return violations;
}

/** A failure message that names the rule, the impact and the element. */
export function describeViolations(violations: readonly Result[]): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => node.target.join(" "))
        .join(", ");

      return `${violation.id} (${violation.impact ?? "unknown impact"}): ${violation.help}\n  at ${targets}\n  ${violation.helpUrl}`;
    })
    .join("\n\n");
}

/**
 * Assert a rendered subtree has no WCAG violation.
 *
 * Throws with the full axe report rather than a bare "expected 0", because a
 * violation count tells you nothing about what to fix.
 */
export async function expectNoAccessibilityViolations(
  context: ElementContext,
): Promise<void> {
  const violations = await findAccessibilityViolations(context);

  if (violations.length > 0) {
    throw new Error(
      `axe found ${violations.length} WCAG violation(s):\n\n${describeViolations(violations)}`,
    );
  }
}

/**
 * Stamp a theme on the document the way the root layout does, run a check, then
 * put the document back.
 *
 * Every component has to hold up in both palettes (AC-4), and a test that only
 * ever runs in the default one proves half of that.
 */
export async function withTheme<T>(
  theme: StoredTheme,
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = document.documentElement.getAttribute("data-theme");
  document.documentElement.setAttribute("data-theme", theme);

  try {
    return await run();
  } finally {
    if (previous === null) {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", previous);
    }
  }
}

/** Both palettes, for `describe.each` / `it.each`. */
export const THEMES: readonly StoredTheme[] = ["light", "dark"];
