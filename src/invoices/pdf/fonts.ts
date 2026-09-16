/**
 * Embedding Inter into the PDF (spec 0013, AC-5, AC-8).
 *
 * Re-registers the family fresh on every call, deliberately diverging from
 * spec 0013's original design (register once per process, guarded by
 * `Font.getRegisteredFontFamilies()`): `@react-pdf/renderer`'s font embedding
 * mutates subset and glyph state directly on the shared, cached `fontkit`
 * font object (`@react-pdf/render`'s `encodeGlyphs` writes `font.subset`,
 * `font.widths` and `font.unicode` onto it in place). Reusing that same
 * object across two unrelated PDF renders in one process corrupts glyphs in
 * the second render — confirmed while building this feature: rendering one
 * plain invoice and then one containing "ı" silently turned "ı" into "9" in
 * the second file's extracted text, with no error and no warning. Deleting
 * and re-registering the family before every render forces a fresh parse (and
 * a fresh, unshared subset), which is the only reliable fix found. This spec
 * gap is flagged for `/architect` to correct in spec 0013's Consequences,
 * which still claims the file is read once per process.
 */
import path from "node:path";

import { Font } from "@react-pdf/renderer";

/** The one family the PDF ever sets; every weight it uses is registered under it. */
export const INVOICE_FONT_FAMILY = "Inter";

const FONTS_DIR = path.join(process.cwd(), "src/invoices/pdf/fonts");

/** No word is ever hyphenated (spec 0013, AC-5): return it whole. */
function noHyphenation(word: string): string[] {
  return [word];
}

export function registerInvoiceFonts(): void {
  // `Font.getRegisteredFonts()` returns the store's own live map; deleting our
  // entry from it (rather than calling the store-wide `Font.clear()` or
  // `Font.reset()`) leaves every other registered family, including the
  // renderer's built in standard fonts, untouched.
  delete Font.getRegisteredFonts()[INVOICE_FONT_FAMILY];

  Font.register({
    family: INVOICE_FONT_FAMILY,
    fonts: [
      { src: path.join(FONTS_DIR, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONTS_DIR, "Inter-SemiBold.ttf"), fontWeight: 600 },
    ],
  });

  Font.registerHyphenationCallback(noHyphenation);
}
