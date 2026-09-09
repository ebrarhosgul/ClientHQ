/**
 * The theme, and the one cookie that stores it. Spec 0004.
 *
 * Three choices, two stored values: `system` is the *absence* of the cookie
 * rather than the word "system". Keeping "no cookie" and "follow the operating
 * system" the same state means they can never disagree, which two states would
 * eventually let them do.
 *
 * No React here on purpose. The Server Action writes the cookie, the root
 * layout reads it, and the control renders from it, so this module is shared by
 * all three and pulls nothing into the browser bundle.
 */
import { z } from "zod";

export const THEME_COOKIE = "clienthq_theme";

/** What the cookie may hold. `system` is never written; it deletes instead. */
export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The two palettes. `system` resolves to one of these in the browser. */
export type StoredTheme = Exclude<ThemeChoice, "system">;

export const themeChoiceSchema = z.enum(THEME_CHOICES);

/** Parse whatever came back from `cookies()`, which is `string | undefined`. */
export function readStoredTheme(
  value: string | undefined,
): StoredTheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** One year. Long enough that a choice feels permanent, short enough to lapse. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
