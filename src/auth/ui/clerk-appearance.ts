import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

/**
 * Clerk does not export its appearance type by name from `@clerk/nextjs`, and
 * the package that declares it is not a direct dependency of this project, so
 * it is taken from the prop that consumes it. Type only, so nothing is bundled.
 *
 * The provider's prop rather than a component's: only the provider accepts
 * `cssLayerName`, and a per component override would merge on top of this
 * anyway, so there is nothing to gain by setting it in two places.
 */
type ClerkAppearance = NonNullable<
  ComponentProps<typeof ClerkProvider>["appearance"]
>;

/**
 * Clerk's components, wearing this product's tokens.
 *
 * Every value is a `var()` pointing at a token in `src/app/globals.css` rather
 * than a colour of its own. That is what makes the theme work in both
 * directions for free (spec 0005, AC-3): the tokens already carry a light and a
 * dark value, the root layout stamps `data-theme` from the cookie on the server,
 * and the browser resolves whichever is in force at paint time. There is no
 * second palette to keep in step, no JavaScript deciding which one to send, and
 * no flash of the wrong theme, because nothing here is decided after the first
 * frame.
 *
 * It also keeps the project's own rule intact: no component carries a literal
 * colour, `src/ui/token-discipline.test.ts` included, which scans this file
 * along with everything else under `src/`.
 *
 * What the variables cannot reach is how Clerk draws a control's edge. That is
 * handled by one rule in `src/app/globals.css`, which explains why it has to
 * live there rather than here.
 *
 * `cssLayerName` puts Clerk's stylesheet inside a cascade layer. Tailwind v4
 * puts its utilities in layers too, and this project's one focus ring is
 * declared deliberately *outside* any layer so nothing can weaken it
 * (design.md, accessibility rule 1). Without this, Clerk's own unlayered focus
 * styles would compete with it and the product would have two.
 */
export const clerkAppearance: ClerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",

    // Clerk draws its own card, and it sits on this product's page, so it takes
    // the card tokens rather than the page background.
    colorBackground: "var(--card)",
    colorForeground: "var(--card-foreground)",

    colorMuted: "var(--muted)",
    colorMutedForeground: "var(--muted-foreground)",
    colorNeutral: "var(--foreground)",

    // `--input` is the control boundary, measured to 3:1 against every surface
    // it sits on; `--background` is what a field is filled with.
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",

    colorDanger: "var(--destructive)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",

    fontFamily: "var(--font-inter)",
    fontFamilyMono: "var(--font-jetbrains-mono)",
    borderRadius: "var(--radius)",
  },
  options: {
    // The product already says "ClientHQ" above the card, in the frame.
    // Repeating it inside would be the same word twice on a small screen.
    socialButtonsVariant: "blockButton",
    socialButtonsPlacement: "top",
  },
};
