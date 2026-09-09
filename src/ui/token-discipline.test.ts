/**
 * @vitest-environment node
 *
 * Invariants 1 and 11, checked across every file in `src/ui/` and `src/app/`.
 *
 * Spec 0004 enforces "every colour comes from a token" by review, which is the
 * weaker half of what this project already does for the raw database handle. It
 * has a follow up for a proper `clienthq/no-literal-colour` ESLint rule. Until
 * that exists, this test is the cheap version: it cannot see a colour built at
 * runtime, but it catches the two ways a colour actually leaks in, which is a
 * hex value pasted from a design tool and an opacity modifier on a token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import fg from "fast-glob";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

const FILES = fg
  .sync(["src/ui/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"], { cwd: ROOT })
  // The contrast machinery and its test are *about* colour values, so they hold
  // the only literal colours in the codebase on purpose.
  .filter((file) => !file.startsWith("src/ui/contrast"))
  .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Strip block and line comments, so prose about a rule cannot trip the rule. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("no literal colour outside the token layer", () => {
  it.each(FILES)("%s carries no hex colour", (file) => {
    const source = withoutComments(read(file));

    expect(source).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?!\w)/);
  });

  it.each(FILES)("%s carries no rgb, hsl or oklch literal", (file) => {
    const source = withoutComments(read(file));

    // `var(--token)` is how a colour reaches a style attribute; a function call
    // with numbers in it is a colour someone typed.
    expect(source).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab)\(\s*[\d.]/);
  });

  it.each(FILES)("%s puts no opacity modifier on a colour token", (file) => {
    const source = withoutComments(read(file));

    // `bg-primary/10` produces a colour declared nowhere, so the contrast test
    // cannot measure it. A tint is always its own explicit token pair.
    expect(source).not.toMatch(
      /\b(?:bg|text|border|ring|outline|fill|stroke|divide|placeholder|decoration|shadow|from|via|to)-(?:primary|secondary|accent|destructive|success|warning|info|muted|card|popover|background|foreground|border|input|ring|chip-[a-z]+)(?:-[a-z]+)*\/\d+/,
    );
  });

  it.each(FILES)(
    "%s names no colour Tailwind ships rather than one we declared",
    (file) => {
      const source = withoutComments(read(file));

      // `text-white`, `bg-slate-100` and friends do not move with the theme, so
      // they are correct in one palette and wrong in the other.
      expect(source).not.toMatch(
        /\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/,
      );
    },
  );
});

describe("no component declares its own focus ring", () => {
  it.each(FILES)("%s leaves the ring to globals.css", (file) => {
    const source = withoutComments(read(file));

    // One unlayered `:focus-visible` rule covers the product. A component that
    // adds its own can only make it weaker, and `outline-none` deletes it.
    expect(source).not.toMatch(/focus(?:-visible)?:(?:ring|outline|border)-/);
    expect(source).not.toMatch(/\boutline-(?:none|hidden)\b/);
  });
});
