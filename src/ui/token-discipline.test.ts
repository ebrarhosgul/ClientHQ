/**
 * @vitest-environment node
 *
 * Invariants 1 and 11, checked across the whole `src/` tree (spec 0021 widened
 * this from `src/ui/`, `src/app/` and `src/dashboard/ui/`, since most of the
 * files the link styling migration touches, `src/invoices/ui/`,
 * `src/deliverables/ui/`, `src/portal/ui/`, `src/auth/ui/`,
 * `src/analytics/ui/`, sit outside that earlier reach).
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

/**
 * Spec 0021: the two links that genuinely sit inline in a sentence of plain
 * text, where colour alone cannot clear WCAG 1.4.1 in dark mode, so they keep
 * `link-accent-inline`'s underline instead of moving to `link-accent`.
 */
const UNDERLINE_EXCEPTIONS = [
  "src/ui/patterns/action-error.tsx",
  "src/analytics/ui/cookie-banner.tsx",
];

const FILES = fg
  .sync(["src/**/*.{ts,tsx}"], { cwd: ROOT })
  // The contrast machinery and its test are *about* colour values, so they hold
  // the only literal colours in the codebase on purpose.
  .filter((file) => !file.startsWith("src/ui/contrast"))
  // These three render outside the app's CSS custom property pipeline, so a
  // literal is the only option, not a leak: `@react-pdf` (invoice-pdf.tsx) and
  // `react-email` (email/templates/) each ship their own styling with no
  // access to globals.css, and download-error-page.ts is a route handler with
  // no stylesheet, documented in its own header as copying four token values
  // by hand and locked to the source by `download-error-page.test.ts` instead.
  .filter((file) => !file.startsWith("src/invoices/pdf/"))
  .filter((file) => !file.startsWith("src/email/templates/"))
  .filter((file) => file !== "src/deliverables/download-error-page.ts")
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

describe("a link uses link-accent or link-accent-inline, not a raw underline", () => {
  it.each(FILES.filter((file) => !UNDERLINE_EXCEPTIONS.includes(file)))(
    "%s carries no raw underline class",
    (file) => {
      const source = withoutComments(read(file));

      // `\bunderline\b` alone catches `underline`, `underline-offset-2` and
      // `hover:underline` too: the hyphen and colon around it are non word
      // characters, so the boundary already falls right after "underline".
      expect(source).not.toMatch(/\bunderline\b/);
    },
  );
});
