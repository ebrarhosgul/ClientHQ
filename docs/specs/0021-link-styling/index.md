# 0021. Link styling: colour and weight instead of underline by default

**Date**: 2026-09-24
**Status**: Accepted

## Summary

This spec replaces the underline as the default look for clickable text across the product with a brand teal text colour, a slightly bolder weight, and a soft background highlight on hover or keyboard focus. It keeps a real WCAG rule in mind: a link still has to be told apart from plain text by more than colour alone, so a small number of links that sit inline in the middle of a sentence keep a line, everywhere else does not need one. It gives the two shadcn `link` variants and roughly sixteen dashboard, invoice, project, and portal files one shared, single source of truth instead of a hand copied class string.

## Decision

**Chosen option**: Option 1: document the standard and migrate every file in one coordinated change, enforced automatically.

Clickable text gets a new `--link` colour token (the same brand teal as `--primary`, its own token because a CSS token cannot itself reference another token and still be measured for contrast, see Key invariants below) plus two small custom utilities added to `src/app/globals.css`: `link-accent` for a link that occupies its own line or its own value (the large majority: dashboard rows, stat cards, "View all" links, the shadcn `Button`/`Badge` `link` variants, standalone paragraph links like the privacy footer notice), and `link-accent-inline` for the small, named set of links that sit inline inside a sentence of plain text and therefore keep a line. `token-discipline.test.ts` is widened to scan the whole `src/` tree (today it only reaches `src/ui/`, `src/app/`, and `src/dashboard/ui/`) and gains a new check forbidding a raw `underline` Tailwind class anywhere outside the two named inline exception files, so this stops being a convention a person has to remember.

**Implementation skills**: `tailwind` (`.agents/skills/tailwind/`) · `shadcn` (`.agents/skills/shadcn/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`)


## Standard definition

**Canonical pattern**:
```tsx
// A link that is its own whole line, row, or value: a dashboard row link, a
// stat card's value, a "View all" link, the shadcn Button/Badge `link`
// variant, or a standalone paragraph link (e.g. a footer notice).
<Link href="/invoices/inv_123" className="link-accent transition-surface">
  {formatInvoiceNumber(row.number)}, {row.clientName}
</Link>

// A link that sits inline inside a sentence of plain text (rare; today only
// the cookie banner's consent notice and the subscription-inactive billing
// recovery link). Keeps a line, because colour alone cannot clear WCAG 1.4.1
// against plain sentence text in dark mode (see Rationale).
<Link href="/privacy" className="link-accent-inline">
  privacy notice
</Link>
```

```css
/* src/app/globals.css, beside the other @utility declarations */
@utility link-accent {
  color: var(--link);
  font-weight: 500;
  border-radius: var(--radius-sm);
  padding-inline: 0.25rem;
  margin-inline: -0.25rem;

  &:hover,
  &:focus-visible {
    background-color: var(--accent);
    color: var(--accent-foreground);
  }
}

@utility link-accent-inline {
  color: var(--link);
  font-weight: 500;
  text-decoration-line: underline;
  text-underline-offset: 2px;

  &:hover,
  &:focus-visible {
    color: var(--accent-foreground);
  }
}
```

Both utilities are always paired with the project's existing `transition-surface` utility (never redeclare `transition-property` inside them, `globals.css` already owns that rule once). `link-accent`'s padding and matching negative margin keep the hover/focus background from shifting surrounding layout, the same technique a padded, negatively margined hit area already uses elsewhere in the design system.

**New token** (add to all three theme blocks in `src/app/globals.css`, and to the `@theme inline` mapping as `--color-link: var(--link);`):
- Light: `--link: oklch(0.52 0.09 182);` (identical to `--primary`'s light value)
- Dark (both the `prefers-color-scheme` block and the explicit `[data-theme="dark"]` block): `--link: oklch(0.72 0.11 182);` (identical to `--primary`'s dark value)

**New contrast pair** (add to `src/ui/contrast.ts`'s `CONTRAST_PAIRS`): `textPair("link text on a card", "--link", "--card")`. The hover/focus background reuses the already declared, already measured `accent surface label` pair (`--accent-foreground` on `--accent`); no new pair needed for it.

**Replaces**:
- `underline underline-offset-2` (and the `underline-offset-4` variant used in the footer and cookie banner) as a static, always-on line
- `underline-offset-2 hover:underline` / `hover:underline` as a hover-only line with no static cue at rest
- The shadcn `Button` and `Badge` `link` variants' current `text-primary underline-offset-4 hover:underline` (`src/ui/primitives/button.tsx:47`, `src/ui/primitives/badge.tsx:20`); their disabled state keeps dropping to `disabled:text-muted-foreground disabled:no-underline` (per the project's existing "a disabled control drops to the muted pair" rule), simply losing the now-obsolete `no-underline` half since there is no underline to remove

**Enforcement**:
A Vitest check in `src/ui/token-discipline.test.ts` (the existing home for this class of design system rule), extended two ways:
1. Widen its `FILES` glob from `["src/ui/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}", "src/dashboard/ui/**/*.{ts,tsx}"]` to the whole product tree, e.g. `"src/**/*.{ts,tsx}"` (still excluding `*.test.ts(x)` and `src/ui/contrast*`), since most of the files this standard touches (`src/invoices/ui/`, `src/deliverables/ui/`, `src/portal/ui/`, `src/auth/ui/`, `src/analytics/ui/`) sit outside its current reach.
2. Add a check that no file outside `src/ui/patterns/action-error.tsx` and `src/analytics/ui/cookie-banner.tsx` (the two named inline exceptions, plus their own gallery mirrors in `src/app/design/gallery.tsx`) carries a literal `underline` Tailwind class (`\bunderline\b`, `\bunderline-offset-\d\b`, or `\bhover:underline\b`) outside a comment.

This is enforced automatically, fails CI, and needs no human to remember the rule, the same strength this project already gives every other token discipline rule.

**Rollout**: single migration PR. Add the token, the two utilities, and the enforcement check first (with the check passing against the two named exceptions and failing loudly against everything else until each file is migrated), then update every current call site in the same change: the two shadcn primitives, the roughly sixteen product files the underline scan found, and the design gallery's mirrored fixtures. New code written after this lands uses `link-accent` or `link-accent-inline` from day one, the enforcement check makes reverting to `underline` a failing build rather than a review miss.

**Exceptions**: `src/ui/patterns/action-error.tsx` and `src/analytics/ui/cookie-banner.tsx` keep `link-accent-inline` (a line stays) rather than `link-accent`, because their links sit inline inside a sentence of plain text where colour alone cannot pass WCAG 1.4.1 in dark mode. No other exceptions: every other current `underline` call site moves to `link-accent`.

## Consequences

**Positive**:
- One canonical, token driven way to style a link, replacing two inconsistent hand copied conventions across roughly sixteen files.
- The dashboard, invoices, projects, and portal pages get a cohesive, brand accented look instead of the default browser underline, without weakening WCAG 1.4.1 anywhere: the two genuinely inline links keep a line, everything else relies on verified contrast plus a real shape change on hover and focus.
- Closes an existing gap noticed while writing this spec: `token-discipline.test.ts` did not reach most of the files this change touches at all (only `src/ui/`, `src/app/`, `src/dashboard/ui/`), so the wider glob also starts catching a literal colour anywhere else in the product, not only this pattern.

**Negative / tradeoffs**:
- A single migration PR touching around eighteen files (two primitives plus roughly sixteen call sites) is a larger review surface at once than a gradual rollout would be, even though every individual edit is a one line class swap.
- `--link` duplicates `--primary`'s literal value rather than referencing it, because `contrast.ts` cannot measure a `var()` reference. The two tokens must be kept in sync by hand if `--primary` is ever retuned; nothing catches a drift between them automatically today (see Follow-up).
- The two inline exceptions keep a visually different, underlined link style permanently. A future reader who does not know this spec exists could reasonably ask why those two links look different from every other link in the product.

**Neutral**:
- `design.md`'s Colour section documents every other token and pattern this precisely; it should gain a short entry for `--link` and the two utilities once this is built, the same way every other shipped design system decision is reflected there.

## Follow-up

- [ ] Once built, add a short "Links" entry to `design.md`'s Colour section documenting `--link`, `link-accent`, and `link-accent-inline`, and when to use each, matching how the rest of the token system is already documented there.
- [ ] Consider a lightweight check (or just a comment beside both declarations) that `--link` and `--primary` are meant to stay identical, since nothing enforces that today and a future colour change to one is easy to make without remembering the other.

