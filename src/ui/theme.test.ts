/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import {
  readStoredTheme,
  THEME_CHOICES,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_LABELS,
  themeChoiceSchema,
} from "./theme";

describe("the theme vocabulary", () => {
  it("offers exactly System, Light and Dark", () => {
    expect(THEME_CHOICES).toEqual(["system", "light", "dark"]);
  });

  it("labels every choice", () => {
    for (const choice of THEME_CHOICES) {
      expect(THEME_LABELS[choice]).toEqual(expect.stringMatching(/\S/));
    }
  });

  it("names the cookie once, so nothing has to spell it twice", () => {
    expect(THEME_COOKIE).toBe("clienthq_theme");
  });

  it("keeps the choice for a year", () => {
    expect(THEME_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 365);
  });
});

describe("parsing a choice", () => {
  it.each(THEME_CHOICES)("accepts %s", (choice) => {
    expect(themeChoiceSchema.safeParse(choice).success).toBe(true);
  });

  it.each(["solarized", "", "LIGHT", null, undefined, 1, {}])(
    "refuses %s",
    (value) => {
      expect(themeChoiceSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("reading the cookie", () => {
  it("reads light and dark back", () => {
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("dark")).toBe("dark");
  });

  it("treats no cookie as no stored choice", () => {
    expect(readStoredTheme(undefined)).toBeUndefined();
  });

  it("treats the word system as no stored choice", () => {
    // `system` is never written. If one ever appears, it means the same thing
    // as no cookie rather than a fourth state.
    expect(readStoredTheme("system")).toBeUndefined();
  });

  it("treats a value that is not a theme as no stored choice", () => {
    expect(readStoredTheme("solarized")).toBeUndefined();
  });
});
