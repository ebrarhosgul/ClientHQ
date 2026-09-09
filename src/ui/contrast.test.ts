/**
 * @vitest-environment node
 *
 * The test that makes AC-2 true and keeps it true.
 *
 * It reads `src/app/globals.css`, not a copy of the palette, so editing a token
 * is what runs it. Adjust a colour until this passes; do not adjust this to
 * accept a colour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTRAST_PAIRS,
  contrastRatio,
  extractTokenBlock,
  formatRatio,
  measurePairs,
  parseTokenBlock,
  relativeLuminance,
  type TokenSet,
} from "./contrast";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const light = extractTokenBlock(css, "tokens:light");
const darkSystem = extractTokenBlock(css, "tokens:dark-system");
const darkExplicit = extractTokenBlock(css, "tokens:dark-explicit");

const themes: readonly (readonly ["light" | "dark", TokenSet])[] = [
  ["light", light],
  ["dark", darkExplicit],
];

describe("the colour maths", () => {
  it("puts black on white at the full 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  it("puts a colour against itself at 1:1", () => {
    expect(
      contrastRatio("oklch(0.52 0.09 182)", "oklch(0.52 0.09 182)"),
    ).toBeCloseTo(1, 6);
  });

  it("does not care which colour is named first", () => {
    const a = contrastRatio("oklch(0.22 0.008 70)", "oklch(0.994 0.002 70)");
    const b = contrastRatio("oklch(0.994 0.002 70)", "oklch(0.22 0.008 70)");

    expect(a).toBeCloseTo(b, 10);
  });

  it("uses sRGB luminance rather than OKLCH lightness", () => {
    // Mid grey is L=0.5 in OKLCH but well under 0.5 in relative luminance.
    // A check that confused the two would read this as 0.5 and let unreadable
    // pairs through.
    expect(relativeLuminance("oklch(0.5 0 0)")).toBeLessThan(0.25);
  });

  it("refuses a value it cannot parse rather than scoring it", () => {
    expect(() => relativeLuminance("not-a-colour")).toThrow(/not a colour/);
  });

  it("rounds a ratio down, so a quoted number is never generous", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
  });
});

describe("reading the stylesheet", () => {
  it("picks the declarations out of a block", () => {
    expect(parseTokenBlock("{ --a: oklch(1 0 0); --b: 0.375rem; }")).toEqual({
      "--a": "oklch(1 0 0)",
      "--b": "0.375rem",
    });
  });

  it("fails loudly when a marked block is missing", () => {
    expect(() =>
      extractTokenBlock("/* nothing here */", "tokens:light"),
    ).toThrow(/no "tokens:light" block/);
  });

  it("finds a real palette in each of the three blocks", () => {
    for (const tokens of [light, darkSystem, darkExplicit]) {
      expect(Object.keys(tokens).length).toBeGreaterThan(20);
    }
  });

  it("keeps the two dark blocks identical", () => {
    // They are declared twice so an explicit choice wins in both directions.
    // If they ever drift, half the users get a palette nobody measured.
    expect(darkExplicit).toEqual(darkSystem);
  });

  it("declares every token the light palette declares in the dark one", () => {
    // `--radius` is light only by design: it is not a colour and does not vary.
    const colourTokens = Object.keys(light).filter(
      (name) => name !== "--radius",
    );

    expect(Object.keys(darkExplicit).sort()).toEqual(colourTokens.sort());
  });
});

describe.each(themes)("the %s palette", (theme, tokens) => {
  const measurements = measurePairs(tokens, theme);

  it.each(measurements.map((m) => [m.label, m] as const))(
    "%s clears its floor",
    (_label, measurement) => {
      // The message is the point of this test: when it fails it has to say
      // which pair, what it measured and what it needed.
      expect(
        measurement.passes,
        `${theme}: ${measurement.label} measured ${formatRatio(measurement.ratio)}, ` +
          `needs ${measurement.floor}:1 ` +
          `(${measurement.foreground} on ${measurement.background})`,
      ).toBe(true);
    },
  );

  it("measures every pair the list names", () => {
    expect(measurements).toHaveLength(CONTRAST_PAIRS.length);
  });

  it("refuses to score a pair whose token is not declared", () => {
    expect(() =>
      measurePairs(tokens, theme, [
        {
          label: "invented",
          foreground: "--nope",
          background: "--background",
          floor: 4.5,
        },
      ]),
    ).toThrow(/declares no --nope/);
  });
});
