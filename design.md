# ClientHQ design system

The visual direction, and what every screen is assembled from. Settled in
[spec 0004](docs/specs/0004-design-system-and-ui-foundation/index.md), which is
the source of truth for the decisions behind anything here.

**Where the values actually live:** `src/app/globals.css`. This document
explains the system and records the measurements; the stylesheet holds the
numbers. When the two disagree, the stylesheet is right, and
`src/ui/contrast.test.ts` is what stops them disagreeing about colour.

---

## The register, and why

Calm neutral utility with a faint warm cast. This is a tool people have open all
day to do administrative work: chase an invoice, check what is due, send a
client a file. It should be quiet, dense enough to see a lot at once, and
completely unsurprising. Nothing here is meant to be noticed.

The warm cast (a hue of 70 on every neutral, rather than a pure grey) is the one
piece of character. It keeps long sessions from feeling clinical without ever
being a colour anyone would name.

Teal is the accent, at hue 182. It is the only saturated colour in the chrome,
so it means "this is the thing to press" wherever it appears. It sits about 34
degrees of hue from the green that means paid, which is far enough to tell apart
and close enough to be worth naming here: a redesign that moves either hue must
recheck that.

---

## Type

Two families, loaded through `next/font/google`:

- **Inter** for everything a person reads.
- **JetBrains Mono** for invoice numbers, ids and anything a person might read
  out loud character by character.

Tailwind's default type scale is used unchanged. What is fixed is the **usage**,
because that is what stops six screens each picking their own heading size:

| Role | Class | Size |
|---|---|---|
| Page title | `text-xl font-semibold tracking-tight` | 20px |
| Section heading | `text-base font-semibold` | 16px |
| Body, table cells, controls | `text-sm` | 14px |
| Secondary, metadata, help text | `text-xs text-muted-foreground` | 12px |

Three weights only: 400, 500, 600. Anything heavier reads as shouting in a tool
this quiet.

`tabular-nums` on every money, count and date column, so figures line up down a
column and a total sits under the numbers it adds up. The shared table applies
it automatically to any column declared `align: "end"`.

---

## Spacing, radius and breakpoints

| Scale | Rule |
|---|---|
| Spacing | Tailwind's 4px rhythm, unchanged |
| Control height | `h-9` (36px); `h-8` small, `h-10` large |
| Table row | `h-10` (40px) |
| Card padding | `p-4`, page gutter `px-6`, section gap `gap-6` |
| Radius | `--radius: 0.375rem` (6px). Tailwind's `sm`, `md`, `lg`, `xl` derive from it |
| Breakpoints | Tailwind's defaults. `md` (768px) is the one that matters: the sidebar becomes a sheet and low priority table columns drop below it |

The density is deliberate and it is a tradeoff: more rows fit, and it is harder
on anyone with low vision. That is why zoom to 200 percent is a required check
in the manual pass, not a nice one.

---

## Colour

Every colour in the product comes from a token declared once in
`src/app/globals.css`. **No component carries a literal colour, and no component
puts an opacity modifier on a colour token.** `bg-primary/10` is forbidden:
a faded token is a colour declared nowhere, so the contrast test cannot measure
it. A tint is always its own explicit background and foreground pair.

`src/ui/token-discipline.test.ts` enforces both rules across `src/ui/` and
`src/app/`.

### The three state pattern

```
:root, [data-theme="light"]                                  → light
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) } → dark
[data-theme="dark"]                                          → dark
```

The root layout reads the `clienthq_theme` cookie and stamps `data-theme` on
`<html>` when it is set, nothing when it is not. So:

- no cookie → the operating system decides, and changing it changes the page
  with no reload;
- an explicit choice wins in **both** directions, including light on a dark
  system;
- the right palette is painted in the first frame, from the server, with no
  blocking script and no flash.

The two explicit blocks are attribute selectors rather than `:root[…]` so a
nested element can carry a theme too. That is what lets `/design` put both
palettes on one screen. On the real pages the attribute only ever appears on
`<html>`.

### Measured contrast

Every pair below is computed from the OKLCH declarations by `src/ui/contrast.ts`
and asserted by `src/ui/contrast.test.ts`. **These numbers are not typed by
hand.** Regenerate them by reading that test if you change a colour; if a pair
drops below its floor, `pnpm test` fails and names it.

| Pair | Tokens | Light | Dark | Floor |
|---|---|---|---|---|
| body text on the page | `--foreground` on `--background` | 17.02:1 | 16.14:1 | 4.5:1 |
| body text on a card | `--card-foreground` on `--card` | 17.32:1 | 14.91:1 | 4.5:1 |
| body text in a popover | `--popover-foreground` on `--popover` | 17.32:1 | 14.91:1 | 4.5:1 |
| body text on a muted panel | `--foreground` on `--muted` | 15.64:1 | 13.43:1 | 4.5:1 |
| muted text on the page | `--muted-foreground` on `--background` | 7.64:1 | 8.06:1 | 4.5:1 |
| muted text on a card | `--muted-foreground` on `--card` | 7.77:1 | 7.45:1 | 4.5:1 |
| muted text on a muted panel | `--muted-foreground` on `--muted` | 7.02:1 | 6.71:1 | 4.5:1 |
| primary button label | `--primary-foreground` on `--primary` | 5.11:1 | 7.91:1 | 4.5:1 |
| secondary button label | `--secondary-foreground` on `--secondary` | 15.18:1 | 13.03:1 | 4.5:1 |
| accent surface label | `--accent-foreground` on `--accent` | 11.40:1 | 9.79:1 | 4.5:1 |
| destructive button label | `--destructive-foreground` on `--destructive` | 5.59:1 | 6.08:1 | 4.5:1 |
| success surface label | `--success-foreground` on `--success` | 6.30:1 | 7.37:1 | 4.5:1 |
| warning surface label | `--warning-foreground` on `--warning` | 4.87:1 | 8.94:1 | 4.5:1 |
| info surface label | `--info-foreground` on `--info` | 5.33:1 | 7.06:1 | 4.5:1 |
| primary button label, hovered | `--primary-foreground` on `--primary-hover` | 6.60:1 | 10.08:1 | 4.5:1 |
| secondary button label, hovered | `--secondary-foreground` on `--secondary-hover` | 13.66:1 | 11.00:1 | 4.5:1 |
| accent surface label, hovered | `--accent-foreground` on `--accent-hover` | 10.43:1 | 8.10:1 | 4.5:1 |
| destructive button label, hovered | `--destructive-foreground` on `--destructive-hover` | 7.21:1 | 7.99:1 | 4.5:1 |
| primary text on the page | `--primary` on `--background` | 5.16:1 | 8.04:1 | 4.5:1 |
| primary text on a card | `--primary` on `--card` | 5.25:1 | 7.42:1 | 4.5:1 |
| destructive text on the page | `--destructive` on `--background` | 5.71:1 | 6.10:1 | 4.5:1 |
| destructive text on a card | `--destructive` on `--card` | 5.81:1 | 5.63:1 | 4.5:1 |
| neutral chip | `--chip-neutral-foreground` on `--chip-neutral` | 8.79:1 | 8.35:1 | 4.5:1 |
| info chip | `--chip-info-foreground` on `--chip-info` | 7.36:1 | 8.30:1 | 4.5:1 |
| success chip | `--chip-success-foreground` on `--chip-success` | 7.81:1 | 8.56:1 | 4.5:1 |
| warning chip | `--chip-warning-foreground` on `--chip-warning` | 7.54:1 | 8.29:1 | 4.5:1 |
| danger chip | `--chip-danger-foreground` on `--chip-danger` | 6.94:1 | 8.02:1 | 4.5:1 |
| focus ring on the page | `--ring` on `--background` | 4.51:1 | 7.47:1 | 3.0:1 |
| focus ring on a card | `--ring` on `--card` | 4.59:1 | 6.90:1 | 3.0:1 |
| focus ring on a muted panel | `--ring` on `--muted` | 4.15:1 | 6.21:1 | 3.0:1 |
| input border on the page | `--input` on `--background` | 3.58:1 | 3.90:1 | 3.0:1 |
| input border on a card | `--input` on `--card` | 3.64:1 | 3.60:1 | 3.0:1 |
| input border on a muted panel | `--input` on `--muted` | 3.29:1 | 3.24:1 | 3.0:1 |
| switch thumb on the off track | `--background` on `--input` | 3.58:1 | 3.90:1 | 3.0:1 |
| switch thumb on the on track | `--background` on `--primary` | 5.16:1 | 8.04:1 | 3.0:1 |
| ticked checkbox on the page | `--primary` on `--background` | 5.16:1 | 8.04:1 | 3.0:1 |
| ticked checkbox on a card | `--primary` on `--card` | 5.25:1 | 7.42:1 | 3.0:1 |
| separator on the page | `--border` on `--background` | 1.38:1 | 1.71:1 | 1.3:1 |
| separator on a card | `--border` on `--card` | 1.41:1 | 1.57:1 | 1.3:1 |
Two notes on that table:

- **`--input` is much darker than `--border`, and they were drafted equal.** An
  input's boundary is the only thing telling you it is a control, so WCAG 1.4.11
  puts it at 3:1. A separator between two blocks of content carries no
  information a person needs, so it has no floor. One value cannot be both a
  quiet hairline and a 3:1 control boundary, so there are two.
- **The separator floor of 1.3:1 is not a WCAG number.** It only catches a
  border that has disappeared entirely into its background.

### Status tints

The word always shows. The tint only reinforces it, so nothing in this product
depends on telling one colour from another.

| Entity | Status | Tint |
|---|---|---|
| Invoice | `draft` | neutral |
| Invoice | `sent` | info |
| Invoice | `paid` | success |
| Invoice | `overdue` | danger |
| Invoice | `void` | neutral, with a border so it differs from `draft` |
| Project | `planning` | neutral |
| Project | `in_progress` | info |
| Project | `in_review` | warning |
| Project | `delivered` | success |
| Deliverable | `pending` | neutral |
| Deliverable | `ready` | success |
| Subscription access | full | no chip; nothing is shown |
| Subscription access | grace | warning, as a banner in the top bar |
| Subscription access | locked, unsubscribed | danger, as a banner in the top bar |

The subscription names are **provisional** and belong to feature 9. It adopts
them or changes `src/ui/patterns/status-chip.tsx` when it lands.

The map is read from the schema enums, so adding a status to the database fails
`src/ui/patterns/status-chip.test.tsx` until someone decides how it looks.

---

## Components

Owned source, generated with the shadcn/ui tool and then brought in line with
the rules above. Named exports only, except where a framework file convention
requires a default (pages, layouts, `src/proxy.ts`).

### `src/ui/primitives/`

| Component | States it must handle |
|---|---|
| `button` | default, hover, focus visible, active, disabled; six variants, six sizes |
| `submit-button` | the above plus pending, driven by `useFormStatus` |
| `input`, `textarea` | default, hover, focus visible, invalid, read only, disabled, placeholder |
| `label` | default, and its peer being disabled |
| `select` | closed, open, selected, disabled |
| `checkbox`, `switch` | unchecked, checked, focus visible, disabled |
| `field` | the wrapper: label, control, description, error |
| `card` | header, action slot, content, footer |
| `badge` | four variants, and as a link |
| `table` | header, body, row hover, footer, caption |
| `dialog`, `sheet` | closed, open, focus trapped, Escape, close returns focus |
| `dropdown-menu` | closed, open, item, destructive item, disabled item, separator |
| `alert` | default and destructive |
| `skeleton` | plus `SkeletonRegion`, which announces the busy state |
| `tooltip` | hidden, shown |
| `separator`, `avatar`, `breadcrumb`, `pagination` | as generated |
| `sonner` | the toast host, mounted once in the root layout |

### `src/ui/patterns/`

`status-chip`, `empty-state`, `error-state`, `error-messages`, `page-header`,
`data-table`, `theme-control`, `brand`.

### `src/ui/shell/`

`app-shell`, `skip-link`, `sidebar-nav`, `navigation`, `top-bar`,
`agency-switcher`, `user-menu`, `mobile-nav-sheet`, `identity`.

---

## Layout rules

### The agency shell

A fixed 240px sidebar with two groups, and a slim sticky top bar.

- **Work**: Dashboard, Clients, Projects, Invoices.
- **Agency**, quieter: Team, Billing, Settings.

Every path is fixed in `src/ui/shell/navigation.ts`: `/dashboard`, `/clients`,
`/projects`, `/invoices`, `/team`, `/billing`, `/settings`. Items whose feature
has not shipped are still real links; each has a placeholder page that hands off
to the route group's `not-found.tsx`, so the link lands inside the shell with an
explanation rather than on a bare 404.

The top bar carries the agency switcher, a breadcrumb **slot**, the theme
control and the user menu. The shell never derives a breadcrumb from the path,
because a client id in a URL is not a label; each feature's own layout fills the
slot with names it already has.

**The shell is chrome and nothing else.** It runs no query, resolves no tenant
context and decides no permission. It reads identity through Clerk's React
hooks, never through `auth()`, which spec 0003 keeps in exactly one file.

Below `md` the sidebar becomes a sheet behind a labelled menu button: focus
stays inside while it is open, `Escape` closes it, focus returns to the button,
and following a link closes it.

### The client portal (built by feature 15)

The same tokens, type, spacing and components, with **no sidebar**. A single top
bar carrying the client's own company name, the theme control and the user menu,
plus a horizontal set of at most three sections: Projects, Deliverables,
Invoices.

**No primary buttons anywhere**, because there is nothing a contact may do.
Empty states describe rather than invite: "No invoices yet", never "Create an
invoice".

The portal wears ClientHQ's chrome, not the agency's. There is no branding, no
logo upload and no white labelling.

### Tables

Each column declares `priority: "high" | "low"`. Two tiers, no ranking. Below
`md` the low priority columns are `hidden`, which removes them from the
accessibility tree as well as the layout, so a screen reader on a phone is not
read six columns nobody can see.

**A whole row is never a link.** A `<tr>` cannot wrap an `<a>`, and a row link
containing buttons is a nested interactive control. The identifying cell holds
the one real link, stretched with an `::after` covering the row; the actions
cell gets its own stacking context above it. One tab stop for the row, then one
per action, each separately named.

No page requires scrolling in two directions at a 320px viewport.

---

## Accessibility

WCAG 2.2 AA is a build requirement here, not a later audit. What enforces it:

| Layer | What it can see |
|---|---|
| `src/ui/contrast.test.ts` | every colour pair, computed from the token values |
| `src/ui/token-discipline.test.ts` | literal colours, opacity modifiers, per component focus rings |
| axe in Vitest (`src/ui/test/axe.ts`) | semantics, names, roles, per component, in both themes |
| axe in Playwright (`e2e/axe.ts`) | the same rules against real routes, with real colour and real layout |
| the manual pass in the spec's `verify.md` | everything above misses |

Both axe runs use the same tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`wcag22aa`. Both run in CI on every push.

The rules every screen inherits:

1. **One focus ring for the whole product**, declared once in `globals.css`,
   outside any cascade layer so a stray `outline-none` cannot delete it. No
   component declares its own. It is never in a transition, because a ring that
   fades in from the text colour is invisible on the button it outlines.
2. **A skip link is the first focusable element** on every shell page.
3. **`aria-current="page"`** on the current section, not just a colour.
4. **Status is never colour alone.** The word always shows.
5. **Every interactive target is at least 24 by 24 CSS pixels**, checked on the
   densest surface, a table row with inline actions.
6. **A Server Action failure renders beside its field**, with `aria-invalid` and
   `aria-describedby` wired, announced through a live region. The `Field`
   wrapper does all of that so no feature has to remember it.
7. **An error is never only in a toast.** A toast reports an outcome and is
   dismissible; an error that scrolls away after four seconds is one nobody
   read.
8. **An error state never shows a stack trace or an `error.digest`**, and always
   offers a way forward.
9. **A skeleton is hidden from assistive technology**, and its `SkeletonRegion`
   announces the region as busy instead.
10. **Under `prefers-reduced-motion: reduce`, every animation and transition is
    off**, not merely faster.
11. **Focus is never obscured by the sticky top bar.** Scroll regions in the
    shell reserve its height.

---

## The `/design` gallery

`/design` renders every primitive and pattern in both palettes, in every state,
from fixtures. It returns not found in production.

It is what makes this system checkable: `/check verify`, the axe suites and
anyone with a screen reader have something real to point at without waiting for
a feature screen. Add to it whenever you add a component.

---

## When you add a component

1. Generate it with the shadcn tool if it has one:
   `pnpm dlx shadcn@latest add <name>`. It writes into `src/ui/primitives/`.
2. Fix what it ships that this system does not allow: the `cn` import path, any
   opacity modifier on a colour token, any focus ring of its own, any
   `opacity-50` disabled state (use the muted pair, which is measured).
3. Add it to `/design`, in every state it has.
4. Add an axe test in both themes, and a token discipline check comes free.
5. Add its row to the component table above.
