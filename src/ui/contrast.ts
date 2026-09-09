/**
 * The colour maths behind AC-2, and the reader that binds it to the real
 * stylesheet.
 *
 * `design.md` records a contrast ratio for every text pair. A number written by
 * hand in a document drifts from the colour actually shipped within a release
 * or two, so nothing here is written by hand: the ratios are computed from the
 * OKLCH declarations in `src/app/globals.css`, and `contrast.test.ts` fails the
 * build when one drops below its floor. The stylesheet is the source; this is
 * the ruler.
 *
 * `culori` does the OKLCH to sRGB conversion. Hand rolling that is where colour
 * maths quietly goes wrong.
 */
import { converter, type Rgb } from "culori";

const toRgb = converter("rgb");

/** WCAG floors. Normal text, and anything whose shape carries meaning. */
export const TEXT_CONTRAST_FLOOR = 4.5;
export const NON_TEXT_CONTRAST_FLOOR = 3;

/**
 * Not a WCAG floor. A hairline that separates two blocks of content carries no
 * information a person needs (the content is already separated by position and
 * spacing), so 1.4.11 sets it no minimum, and holding a decorative rule to 3:1
 * would make the whole product look like a spreadsheet. This floor only catches
 * a border that has effectively disappeared into its background.
 */
export const PERCEPTIBLE_FLOOR = 1.3;

export type ThemeName = "light" | "dark";

export type TokenSet = Readonly<Record<string, string>>;

/**
 * Relative luminance, WCAG 2.x definition.
 *
 * Note this is sRGB luminance, not OKLCH lightness. They are not the same
 * thing, and using `L` from the colour string instead is the usual way a
 * contrast check ends up passing colours a person cannot read.
 */
export function relativeLuminance(colour: string): number {
  const rgb = toRgb(colour) as Rgb | undefined;

  if (!rgb) {
    throw new Error(`not a colour this build can parse: ${colour}`);
  }

  const channel = (value: number): number => {
    const clamped = Math.min(1, Math.max(0, value));
    return clamped <= 0.03928
      ? clamped / 12.92
      : ((clamped + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/** The WCAG ratio between two colours, between 1 and 21. Order does not matter. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded the way a document quotes it, so `design.md` and the test agree. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/**
 * Pull the custom property declarations out of one CSS block.
 *
 * A real CSS parser would be more correct and is not worth the dependency: the
 * token blocks in `globals.css` are flat lists of `--name: value;`, and the
 * test asserts the expected token names are all present, so a block that stops
 * matching this shape fails loudly rather than silently reading as empty.
 */
export function parseTokenBlock(css: string): TokenSet {
  const declarations = css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi);

  return Object.fromEntries(
    [...declarations].map(([, name, value]) => [name, value.trim()]),
  );
}

/** The three token blocks in `globals.css`, found by their marker comments. */
export const TOKEN_BLOCK_MARKERS = [
  "tokens:light",
  "tokens:dark-system",
  "tokens:dark-explicit",
] as const;

export type TokenBlockMarker = (typeof TOKEN_BLOCK_MARKERS)[number];

/**
 * Read one marked block: everything from its `/* tokens:x *\/` comment to the
 * first `}` that closes the `:root` rule inside it.
 */
export function extractTokenBlock(
  css: string,
  marker: TokenBlockMarker,
): TokenSet {
  const start = css.indexOf(`/* ${marker} */`);

  if (start === -1) {
    throw new Error(`globals.css has no "${marker}" block`);
  }

  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);

  if (open === -1 || close === -1) {
    throw new Error(`the "${marker}" block in globals.css is not a rule`);
  }

  return parseTokenBlock(css.slice(open, close));
}

/**
 * A pair the product actually renders, and the floor it has to clear.
 *
 * Maintained by hand, which is the known weakness of this test: a token added
 * to `globals.css` and left out of here is never measured. The test guards the
 * other direction, failing when a name here is missing from the stylesheet, and
 * `design.md` records the list so a reviewer can see what is covered.
 */
export type ContrastPair = {
  readonly label: string;
  readonly foreground: string;
  readonly background: string;
  readonly floor: number;
};

const textPair = (
  label: string,
  foreground: string,
  background: string,
): ContrastPair => ({
  label,
  foreground,
  background,
  floor: TEXT_CONTRAST_FLOOR,
});

const shapePair = (
  label: string,
  foreground: string,
  background: string,
): ContrastPair => ({
  label,
  foreground,
  background,
  floor: NON_TEXT_CONTRAST_FLOOR,
});

const decorativePair = (
  label: string,
  foreground: string,
  background: string,
): ContrastPair => ({
  label,
  foreground,
  background,
  floor: PERCEPTIBLE_FLOOR,
});

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // Body text, on each of the three surfaces it lands on.
  textPair("body text on the page", "--foreground", "--background"),
  textPair("body text on a card", "--card-foreground", "--card"),
  textPair("body text in a popover", "--popover-foreground", "--popover"),
  textPair("body text on a muted panel", "--foreground", "--muted"),

  // The muted tier, the one most likely to sit near the floor.
  textPair("muted text on the page", "--muted-foreground", "--background"),
  textPair("muted text on a card", "--muted-foreground", "--card"),
  textPair("muted text on a muted panel", "--muted-foreground", "--muted"),

  // Filled controls.
  textPair("primary button label", "--primary-foreground", "--primary"),
  textPair("secondary button label", "--secondary-foreground", "--secondary"),
  textPair("accent surface label", "--accent-foreground", "--accent"),
  textPair(
    "destructive button label",
    "--destructive-foreground",
    "--destructive",
  ),
  textPair("success surface label", "--success-foreground", "--success"),
  textPair("warning surface label", "--warning-foreground", "--warning"),
  textPair("info surface label", "--info-foreground", "--info"),

  // Hover states. A control is read while the pointer is over it, so a hover
  // fill is a text background like any other. These tokens exist because
  // invariant 11 forbids `hover:bg-primary/90`: an opacity modifier produces a
  // colour that is not declared anywhere and so cannot be measured here.
  textPair(
    "primary button label, hovered",
    "--primary-foreground",
    "--primary-hover",
  ),
  textPair(
    "secondary button label, hovered",
    "--secondary-foreground",
    "--secondary-hover",
  ),
  textPair(
    "accent surface label, hovered",
    "--accent-foreground",
    "--accent-hover",
  ),
  textPair(
    "destructive button label, hovered",
    "--destructive-foreground",
    "--destructive-hover",
  ),

  // Text tinted with a semantic colour on a plain surface: a link, an inline
  // error, the money figure on an overdue row.
  textPair("primary text on the page", "--primary", "--background"),
  textPair("primary text on a card", "--primary", "--card"),
  textPair("destructive text on the page", "--destructive", "--background"),
  textPair("destructive text on a card", "--destructive", "--card"),

  // Status chips, both halves of every tint.
  textPair("neutral chip", "--chip-neutral-foreground", "--chip-neutral"),
  textPair("info chip", "--chip-info-foreground", "--chip-info"),
  textPair("success chip", "--chip-success-foreground", "--chip-success"),
  textPair("warning chip", "--chip-warning-foreground", "--chip-warning"),
  textPair("danger chip", "--chip-danger-foreground", "--chip-danger"),

  // Shapes that carry meaning: the ring on every surface it can land on, and
  // the input border, which is the only thing telling a text field from the
  // page around it (WCAG 1.4.11). This is why `--input` is a much darker value
  // than `--border` rather than the same one: spec 0004 drafted them equal, and
  // no single value can be both a quiet hairline and a 3:1 control boundary.
  shapePair("focus ring on the page", "--ring", "--background"),
  shapePair("focus ring on a card", "--ring", "--card"),
  shapePair("focus ring on a muted panel", "--ring", "--muted"),
  shapePair("input border on the page", "--input", "--background"),
  shapePair("input border on a card", "--input", "--card"),
  shapePair("input border on a muted panel", "--input", "--muted"),
  decorativePair("separator on the page", "--border", "--background"),
  decorativePair("separator on a card", "--border", "--card"),
];

export type PairMeasurement = ContrastPair & {
  readonly theme: ThemeName;
  readonly ratio: number;
  readonly passes: boolean;
};

/** Measure every pair against one theme's tokens. */
export function measurePairs(
  tokens: TokenSet,
  theme: ThemeName,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): readonly PairMeasurement[] {
  return pairs.map((pair) => {
    const foreground = tokens[pair.foreground];
    const background = tokens[pair.background];

    if (!foreground || !background) {
      throw new Error(
        `the ${theme} palette declares no ${foreground ? pair.background : pair.foreground}`,
      );
    }

    const ratio = contrastRatio(foreground, background);

    return { ...pair, theme, ratio, passes: ratio >= pair.floor };
  });
}
