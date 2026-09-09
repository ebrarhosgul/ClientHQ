# 0004. Design system and UI foundation

**Date**: 2026-09-09
**Status**: Accepted

## Summary

This settles what ClientHQ looks like and what every screen is assembled from, so no later feature invents a look. The direction is calm neutral utility with a faint warm cast: Inter for text, JetBrains Mono for invoice numbers and ids, a teal accent, a compact 4px spacing rhythm and 6px corners, in both a light and a dark theme that the user picks and the choice sticks. It ships design tokens (named colour, size and spacing values every component reads instead of hardcoding), about twenty two base components generated with the shadcn/ui tool into `src/ui/`, the agency dashboard shell, a `/design` gallery page that shows every component in every state, and a rebuilt entry page. Accessibility is treated as a build requirement rather than a later audit: 4.5:1 contrast on all text including muted text, machine checked by a test that reads the token file, plus axe (an automated accessibility checker) in two runners and a written manual pass for the parts no machine can check.

## Requirements

**User stories**:

- As an agency staff member, I want the app to look and behave the same on every screen so that I learn it once and stop thinking about it.
- As an agency staff member, I want to work in dark mode and have that choice remembered so that a full day in the app does not tire my eyes.
- As an agency staff member using a keyboard or a screen reader, I want every control reachable and announced so that I can do my job without a mouse.
- As a client contact, I want the portal to feel like a considered product so that I trust the agency I am paying.
- As the engineer building features 6 through 20, I want tokens, components and a shell already decided so that I build screens instead of relitigating type sizes.

**Acceptance criteria**:

- **AC-1**: `design.md` at the repository root documents the visual register and why, the type usage rules, the full palette for both themes with each measured contrast ratio, the spacing and radius scale, the status tint map, every component in the core set with the states it must handle, the responsive column priority rule, the accessibility rules, and the client portal chrome rules.
- **AC-2**: Every foreground and background pair used for text reaches at least 4.5:1 in both themes, muted and secondary text included, and the focus ring reaches at least 3:1 against both the page background and the card background. A test computes these from the token declarations and fails when any pair drops below its floor.
- **AC-3**: Every colour, radius, spacing and font size in the codebase comes from the token scale declared once in `src/app/globals.css`. No component carries a literal colour, and no component sets a size outside the Tailwind scale.
- **AC-4**: The core component set exists in `src/ui/primitives/` with named exports only, and each component renders correctly in both themes across every state that applies to it: default, hover, focus visible, active, disabled, invalid, loading and read only.
- **AC-5**: A keyboard alone reaches and operates every interactive element in the shell and in the gallery, in a sensible order. Focus is always visible, is never obscured by the sticky top bar or the sidebar, and never enters a trap it cannot leave.
- **AC-6**: The agency shell renders a fixed sidebar with a primary group (Dashboard, Clients, Projects, Invoices) and a quieter secondary group (Team, Billing, Settings), plus a slim top bar carrying the agency switcher, a breadcrumb slot, the theme control and the user menu. The current section carries `aria-current="page"`, and a skip to content link is the first focusable element on the page.
- **AC-7**: Below the `md` breakpoint the sidebar becomes a sheet opened by a labelled menu button. While it is open focus stays inside it, `Escape` closes it, and focus returns to the button that opened it.
- **AC-8**: The theme control offers System, Light and Dark. The choice persists across sessions and a full page load paints the chosen theme in the first frame with no flash of the other one. The control still works with JavaScript switched off.
- **AC-9**: With no stored choice, the rendered theme follows the operating system preference, and changing that preference changes the page with no reload.
- **AC-10**: Each column of the shared table primitive declares a priority of `"high"` or `"low"`, two tiers and no ranking. Below the `md` breakpoint the low priority columns are removed from the accessibility tree as well as the layout, the whole row remains clickable through to its detail page while its inline action buttons stay separately reachable, and no page requires scrolling in two directions at a 320px viewport width.
- **AC-11**: A status chip renders the status word plus a tint, never a tint alone, and the tint map covers every real status in the schema: invoices (`draft`, `sent`, `paid`, `overdue`, `void`), projects (`planning`, `in_progress`, `in_review`, `delivered`), deliverables (`pending`, `ready`), and the subscription access levels feature 9 needs, whose names are provisional here and belong to that feature.
- **AC-12**: One shared empty state (heading, one line of explanation, and the primary action where one exists) and one shared error state (heading, plain language explanation, a retry or a way back, never a stack trace or an error digest) exist, and the error state is what `error.tsx`, `not-found.tsx` and `global-error.tsx` all render. `global-error.tsx` replaces the root layout, so it imports `globals.css` itself, stamps no theme and follows the system preference, and uses the system font stack.
- **AC-13**: A Server Action failure returned as a `Result` value renders beside the field it belongs to, with `aria-invalid` and `aria-describedby` wired to it and the message announced through a live region. A completed action raises a dismissible toast. No error is ever shown only in a toast.
- **AC-14**: Every route segment streams. Slow parts sit behind their own boundary whose fallback is a skeleton shaped like the content that replaces it, marked so assistive technology announces the region as busy rather than reading placeholder shapes.
- **AC-15**: Under `prefers-reduced-motion: reduce`, every transition and animation in the product is switched off.
- **AC-16**: `/design` renders every primitive and every pattern in both themes and in every applicable state, and returns not found when the app runs in production.
- **AC-17**: `/` renders on the real system: one centred card with the product name, one line saying what it is, a primary Sign in, a secondary Create an agency, and the theme control.
- **AC-18**: `ClerkProvider` wraps the app and Clerk runs on every request from `src/proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`; Clerk still supplies `clerkMiddleware()`, exported as the default) with every route public. This feature adds no route protection and no sign in surface; both belong to feature 6.
- **AC-19**: axe reports zero violations against `/`, `/dashboard` and `/design` in Playwright, in both themes, and against every primitive and pattern in Vitest. Both runs are configured with the same rule tags, `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, and both run in CI on every push.
- **AC-20**: The manual pass in `verify.md` is completed and recorded, covering what no tool can check, including the WCAG 2.2 additions: focus not obscured (2.4.11), dragging movements (2.5.7), target size minimum (2.5.8), consistent help (3.2.6) and redundant entry (3.3.7).
- **AC-21**: Every interactive target is at least 24 by 24 CSS pixels, or is separated from its neighbours by enough space to satisfy the WCAG 2.2 spacing exception. This is checked on the densest surface, a table row with inline actions.
- **AC-23**: Every path this feature commits to is fixed here so no later feature has to guess: the agency sections are `/dashboard`, `/clients`, `/projects`, `/invoices`, `/team`, `/billing` and `/settings`; the entry page links to `/sign-in` and `/sign-up`. Sidebar items whose feature has not shipped are still real links, and the agency route group carries a `not-found.tsx` rendering the shared error state, so clicking one lands on a proper page rather than a raw 404.
- **AC-22**: `/dashboard` renders the shell in the real app with an empty dashboard body. Signed in, the top bar shows the real agency name, the real agency list and the real user from Clerk. Signed out, the shell renders without crashing and shows a sign in prompt where the switcher and user menu would be.

## Decision

**Chosen option**: Option 2: A token first system on shadcn/ui, built to a written `design.md`, proved on a gallery route.

Adopt shadcn/ui's own semantic token names extended with the statuses this product needs, declare their OKLCH values once on `:root` and its two dark overrides and expose them to Tailwind through `@theme inline`, generate the base components into `src/ui/` as owned source, define the agency shell and the portal chrome rules in a root `design.md`, and prove the whole chain on a `/design` gallery plus a rebuilt `/` and `/dashboard`.

**Implementation skills**: `shadcn` (`.agents/skills/shadcn/`) · `shadcn-ui` (`.agents/skills/shadcn-ui/`) · `tailwind` (`.agents/skills/tailwind/`) · `tailwind-design-system` (`.agents/skills/tailwind-design-system/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `wcag-audit-patterns` (`.agents/skills/wcag-audit-patterns/`) · `responsive-design` (`.agents/skills/responsive-design/`) · `web-design-guidelines` (`.agents/skills/web-design-guidelines/`) · `nextjs-v16` (`.agents/skills/nextjs-v16/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `vercel-react-best-practices` (`.agents/skills/vercel-react-best-practices/`) · `react-patterns` (`.agents/skills/react-patterns/`) · `clerk-react-patterns` (`.agents/skills/clerk-react-patterns/`) · `vitest` (`.agents/skills/vitest/`) · `playwright-cli` (`.agents/skills/playwright-cli/`)

## Rationale

Reasoning, the options weighed and the premise note: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

No database tables, no columns, no migration. The only persisted state is one cookie.

| Store | Name | Value | Attributes | Absent means |
|---|---|---|---|---|
| Cookie | `clienthq_theme` | `"light"` or `"dark"` | `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, `maxAge` one year | follow the operating system preference |

The cookie is written and deleted only by a Server Action and read only on the server, so it does not need to be readable from the browser. Choosing System deletes it rather than storing the word `system`, which keeps "no cookie" and "follow the system" the same state instead of two states that can disagree.

**State transitions**:

Theme, any state to any state, chosen by the user:

```
System (no cookie)  →  Light (cookie "light")  →  Dark (cookie "dark")  →  System (cookie deleted)
```

Rendering rule, the three state pattern:

- Light palette on bare `:root`.
- Dark overrides inside `@media (prefers-color-scheme: dark)`, guarded as `:root:not([data-theme="light"])`.
- Dark overrides again inside `:root[data-theme="dark"]`, so an explicit choice wins in both directions.
- The root layout reads the cookie and stamps `data-theme` on `<html>` when it is present, nothing when it is not.

**Token values, the starting point** (the contrast test in build task 3 is authoritative; adjust these until it passes rather than the other way round):

Scales, all reused from Tailwind v4's defaults so nothing is redefined:

| Scale | Rule |
|---|---|
| Type | Tailwind's default scale, unchanged. Usage is fixed instead: body and table cells `text-sm` (14px), secondary and metadata `text-xs` (12px), section heading `text-base` semibold, page title `text-xl` semibold. Weights 400, 500 and 600 only |
| Numerals | `tabular-nums` on every money, count and date column. JetBrains Mono for invoice numbers and ids |
| Spacing | Tailwind's 4px rhythm. Control height `h-9` (36px), table row `h-10` (40px), card padding `p-4`, page gutter `px-6`, section gap `gap-6` |
| Radius | `--radius: 0.375rem` (6px); shadcn derives its sm, md, lg and xl from it |
| Breakpoints | Tailwind's defaults. `md` (768px) is the one that matters: the sidebar becomes a sheet and low priority table columns drop below it |

Light theme, on bare `:root`:

| Token | Value | Note |
|---|---|---|
| `--background` | `oklch(0.994 0.002 70)` | near white, faintly warm |
| `--foreground` | `oklch(0.22 0.008 70)` | |
| `--card`, `--popover` | `oklch(1 0 0)` | sits above the page |
| `--muted` | `oklch(0.965 0.004 70)` | |
| `--muted-foreground` | `oklch(0.47 0.010 70)` | must clear 4.5:1 on both `--background` and `--muted` |
| `--border`, `--input` | `oklch(0.905 0.005 70)` | input borders must clear 3:1 |
| `--ring` | `oklch(0.55 0.10 182)` | must clear 3:1 on both `--background` and `--card` |
| `--primary` | `oklch(0.52 0.09 182)` | teal, a background for light text |
| `--primary-foreground` | `oklch(0.99 0.005 182)` | |
| `--secondary` | `oklch(0.955 0.005 70)` | foreground is `--foreground` |
| `--accent` | `oklch(0.945 0.012 182)` | foreground `oklch(0.30 0.05 182)` |
| `--destructive` | `oklch(0.53 0.19 27)` | foreground `oklch(0.99 0.01 27)` |
| `--success` | `oklch(0.52 0.12 148)` | foreground `oklch(0.99 0.01 148)` |
| `--warning` | `oklch(0.62 0.13 75)` | foreground `oklch(0.20 0.03 75)` |
| `--info` | `oklch(0.52 0.13 250)` | foreground `oklch(0.99 0.01 250)` |

Status chip pairs, light. Each tint is an explicit background and foreground pair, never a faded solid, so both sides can be measured:

| Tint | Background | Foreground |
|---|---|---|
| neutral | `oklch(0.955 0.004 70)` | `oklch(0.38 0.010 70)` |
| info | `oklch(0.955 0.030 250)` | `oklch(0.42 0.130 250)` |
| success | `oklch(0.955 0.035 148)` | `oklch(0.40 0.100 148)` |
| warning | `oklch(0.960 0.045 75)` | `oklch(0.42 0.090 75)` |
| danger | `oklch(0.955 0.030 27)` | `oklch(0.45 0.160 27)` |

Dark theme, redeclared in both the guarded media block and `:root[data-theme="dark"]`:

| Token | Value | Note |
|---|---|---|
| `--background` | `oklch(0.175 0.006 70)` | |
| `--foreground` | `oklch(0.945 0.004 70)` | |
| `--card`, `--popover` | `oklch(0.215 0.007 70)` | |
| `--muted` | `oklch(0.255 0.007 70)` | |
| `--muted-foreground` | `oklch(0.715 0.010 70)` | the pair most likely to sit near the floor |
| `--border`, `--input` | `oklch(0.305 0.008 70)` | |
| `--ring` | `oklch(0.70 0.11 182)` | |
| `--primary` | `oklch(0.72 0.11 182)` | roles flip: a light teal carrying dark text |
| `--primary-foreground` | `oklch(0.18 0.03 182)` | |
| `--destructive` | `oklch(0.68 0.17 27)` | dark foreground |
| `--success` | `oklch(0.70 0.13 148)` | dark foreground |
| `--warning` | `oklch(0.78 0.13 80)` | dark foreground |
| `--info` | `oklch(0.70 0.13 250)` | dark foreground |
| chip backgrounds | around `oklch(0.28 0.045 <hue>)` | with foregrounds around `oklch(0.82 0.11 <hue>)`, same five hues |

**Status tint map** (the word always shows; the tint only reinforces it):

| Entity | Status | Tint |
|---|---|---|
| Invoice | `draft` | neutral |
| Invoice | `sent` | info |
| Invoice | `paid` | success |
| Invoice | `overdue` | danger |
| Invoice | `void` | neutral, lower emphasis, with a border |
| Project | `planning` | neutral |
| Project | `in_progress` | info |
| Project | `in_review` | warning |
| Project | `delivered` | success |
| Deliverable | `pending` | neutral |
| Deliverable | `ready` | success |
| Subscription access (feature 9) | full | no chip, nothing is shown |
| Subscription access (feature 9) | grace | warning, as an alert banner in the top bar |
| Subscription access (feature 9) | locked or unsubscribed | danger, as an alert banner in the top bar |

**Component inventory** (each name is a file in `kebab-case`, named exports only):

- `src/ui/primitives/`: `button`, `input`, `textarea`, `label`, `select`, `checkbox`, `switch`, `field`, `card`, `badge`, `table`, `dialog`, `sheet`, `dropdown-menu`, `alert`, `skeleton`, `toaster`, `tooltip`, `separator`, `avatar`, `breadcrumb`, `pagination`
- `src/ui/patterns/`: `status-chip`, `empty-state`, `error-state`, `error-messages`, `page-header`, `data-table`, `theme-control`
- `src/ui/shell/`: `app-shell`, `skip-link`, `sidebar-nav`, `top-bar`, `agency-switcher`, `user-menu`, `mobile-nav-sheet`
- `src/ui/`: `contrast.ts` (the colour maths), `lib/cn.ts` (the class merge helper the shadcn tool expects), `test/axe.ts`

**Client portal chrome rules** (written here, built by feature 15): the same tokens, type, spacing and components, with no sidebar. A single top bar carrying the client's own company name, the theme control and the user menu, and a horizontal set of at most three sections (Projects, Deliverables, Invoices). No primary buttons anywhere, because there is nothing a contact may do. Empty states in the portal describe rather than invite, so "No invoices yet" and never "Create an invoice".

**API surface**:

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `setThemeAction` | Server Action | `theme: "system" \| "light" \| "dark"` (req) | `Result<void>` from `src/db/tenant/errors.ts`, then `revalidatePath("/", "layout")` | public, no tenant context | an invalid value returns `failure({ code: "validation", message: "That is not a theme." })` and leaves the cookie untouched. `ACTION_ERROR_CODES` is a closed set, so the code is `validation`, not a new one |
| `/` | page, GET | none | the entry card | public | none |
| `/dashboard` | page, GET | none | the shell with an empty body | public in this feature, feature 6 protects it | signed out renders the chrome with a sign in prompt |
| `/design` | page, GET | none | the component gallery | development only | `notFound()` when the app runs in production |
| `AppShell` | server component | `children`, `breadcrumb?: ReactNode` | the chrome | not applicable | not applicable |
| `AgencySwitcher`, `UserMenu` | client components | none, they read Clerk | the chrome controls | Clerk session through `ClerkProvider` | not loaded yet renders a skeleton, signed out renders the sign in prompt |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Root layout render | the active theme | the `clienthq_theme` cookie read with `cookies()`; absent, no `data-theme` is stamped and the CSS `prefers-color-scheme` block decides |
| `setThemeAction` | the stored value | the action's own Zod parsed `theme` argument; `"system"` deletes the cookie |
| Top bar | the agency name | Clerk `useOrganization()` |
| Agency switcher | the list of agencies the user belongs to | Clerk `useOrganizationList()` |
| Agency switcher, on select | the new active agency | Clerk `setActive({ organization })`; the server sees it on the next request through the session |
| User menu | user name, email, avatar | Clerk `useUser()` |
| Sidebar | which item is current | `usePathname()` compared against each item's `href` |
| Breadcrumb | the trail | the shell renders a slot; each feature's own layout or page fills it. The shell never derives a trail from the path, because a client id in a URL is not a label |
| Status chip | the tint pair for a status | the status value looked up in the tint map in `src/ui/patterns/status-chip.tsx`, whose values are tokens from `globals.css` |
| Table primitive | which columns are hidden | each column's declared `priority` in its own column definition, supplied by the calling feature |
| Skeleton fallback | the placeholder shape | a skeleton variant exported beside the component it stands in for, so the two cannot drift apart |
| Empty state | heading, explanation, action | supplied by the calling feature; the pattern ships no copy of its own |
| Error state | the message shown | a fixed plain sentence per boundary. A `Result` failure supplies an error code, mapped to a sentence in `src/ui/patterns/error-messages.ts`. `error.digest` and any raw message are never rendered |
| `design.md` | each recorded contrast ratio | computed from the OKLCH token values by `src/ui/contrast.ts` and asserted by `src/ui/contrast.test.ts`, so the recorded number and the shipped colour cannot disagree |

**Key invariants**:

1. No component carries a literal colour, and none sets a size, radius or spacing value outside the token scale. The tokens in `src/app/globals.css` are the only source.
2. Only `src/db/tenant/session.ts` calls Clerk's server side `auth()` (spec 0003). The shell reads identity through Clerk's React hooks, never through `auth()` and never through the tenant layer.
3. The shell is chrome and nothing else. It runs no database query, resolves no tenant context, and decides no permission. Those belong to spec 0003's layer and to each feature's own layout.
4. Status is never conveyed by colour alone.
5. Every text pair reaches 4.5:1 in both themes; the focus ring reaches 3:1 against both the page and the card background.
6. Focus is always visible and never covered by sticky chrome.
7. An error never appears only in a toast.
8. `/design` is unreachable in production.
9. The theme is decided on the server and painted in the first frame. No client script picks it.
10. Named exports only. Where the shadcn tool generates a default export, it is converted on generation. The one exception is where a framework file convention requires a default, including `src/proxy.ts`, pages and layouts.
11. No opacity modifier on a colour token. `bg-primary/10` and `ring-ring/50` are forbidden, because a faded token cannot be contrast checked from its declared value and would slip past the contrast test. A tint is always its own explicit token pair.
12. A whole row is never an `<a>`. A `<tr>` cannot wrap one, and a row link containing buttons is a nested interactive control. The row is made clickable by the identifying cell's link carrying a stretched `::after` that covers the row, with the actions cell given its own stacking context above it, so each button stays separately focusable and separately labelled.

**Security model**:

- The theme cookie carries no personal data. It is `httpOnly` and `sameSite=lax`, so it is not readable from script and not sent on cross site navigations that matter.
- `setThemeAction` is deliberately public and takes a two option enum parsed by Zod. It touches no tenant data, so it needs no tenant context. It is the one Server Action in the product that does not go through `withTenantAction()`, and it says so in a comment.
- `clerkMiddleware()` runs with **every route public**. This feature protects nothing. That is safe only while no agency route renders tenant data, which holds here because `/dashboard` renders chrome and an empty body. Feature 6 must narrow the matcher before feature 7 puts a real client list behind it. See the negative consequence below and the follow up.
- `/design` is gated on the build mode, not on a session, because it renders fixtures and nothing else.
- The only personal data on screen is the signed in user's own name, email and avatar, rendered by Clerk's hooks in the user menu. No compliance scope is triggered.

**Configuration required**:

No new environment variables. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are already declared in `src/lib/env.ts` by spec 0003 and are what `ClerkProvider` needs.

New dependencies:

| Package | Where | Why |
|---|---|---|
| `lucide-react` | dependency | the icon set, and the one shadcn generates against |
| `sonner` | dependency | the toast host |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | dependencies | what the shadcn components themselves import |
| `@radix-ui/*` | dependencies | pulled in per component by the shadcn tool, not added by hand |
| `axe-core` | devDependency | the accessibility engine, driven directly in Vitest through a small helper rather than through a wrapper package that can rot |
| `@axe-core/playwright` | devDependency | the same engine against real rendered routes |
| `culori` | devDependency | OKLCH to sRGB conversion for the contrast test, so the colour maths is not hand rolled |

**Critical test scenarios**:

- Happy path: a signed in user loads `/dashboard`, sees the shell with their real agency and name, switches to Dark, reloads, and the page paints dark in the first frame, verifies **AC-6**, **AC-8**, **AC-22**
- Happy path: `/design` renders every primitive in both themes and axe reports zero violations, verifies **AC-4**, **AC-16**, **AC-19**
- Failure case: a token is edited so `--muted-foreground` drops to 4.2:1 against `--background`; `pnpm test` fails naming the pair and both ratios, verifies **AC-2**
- Failure case: `setThemeAction` is called with `"solarized"`; it returns a `validation` failure through the project's existing `Result`, the cookie is unchanged, and the page still renders, verifies **AC-8**
- Failure case: a Server Action returns a field error; the message appears beside the field, `aria-invalid` is set, `aria-describedby` points at it, and it is announced. It is not in a toast, verifies **AC-13**
- Failure case: a route segment throws; `error.tsx` renders the shared error state with a way back, and no digest or stack appears, verifies **AC-12**
- Auth and permission: signed out at `/dashboard`, the shell renders the chrome with a sign in prompt instead of the switcher and user menu, and nothing crashes, verifies **AC-18**, **AC-22**
- Auth and permission: `/design` with `NODE_ENV=production` returns not found, verifies **AC-16**
- Accessibility: `Tab` from a cold load on `/dashboard` reaches the skip link first, then the sidebar in order, and the focus ring is visible against every background it lands on and is never under the sticky top bar, verifies **AC-5**, **AC-20**
- Accessibility: at a 320px viewport, the invoice table shows only its high priority columns, hidden columns are gone from the accessibility tree, and the page scrolls in one direction only, verifies **AC-10**
- Accessibility: with `prefers-reduced-motion: reduce`, opening a dialog and the mobile sheet produces no animation, verifies **AC-15**
- Accessibility: a table row's inline action buttons measure at least 24 by 24 CSS pixels or carry the required spacing, and tabbing through the row reaches the row link and each button as separate stops rather than one nested control, verifies **AC-21**, **AC-10**
- Failure case: a component is written with `bg-primary/10`; the lint or review check flags it, because a faded token cannot be contrast checked, verifies **AC-2**
- Failure case: `/clients` is opened before feature 7 exists; the agency group's `not-found.tsx` renders the shared error state inside the shell, verifies **AC-23**

## Build plan

Tracer Bullet, so the first slice runs the whole chain thin: one token layer, one component, the theme round trip, one real page, and the accessibility proof in CI. Nothing is thickened until that thread holds. The palette is designed whole in task 2 because a partial palette cannot be contrast checked, but only one component consumes it in slice 1.

**Milestone 1: one thread end to end**

1. [x] Install the dependencies above and run the shadcn tool's initialisation, pointing its aliases at `src/ui/primitives` and `src/ui/lib`, so `components.json` matches the chosen layout rather than the default, satisfies **AC-3**
2. [x] Swap the fonts in `src/app/layout.tsx` to Inter and JetBrains Mono through `next/font/google`, and replace the starter tokens in `src/app/globals.css` with the full palette for both themes plus the spacing, radius, and status tokens, in the three state pattern above, satisfies **AC-2**, **AC-3**
3. [x] Write `src/ui/contrast.ts` and `src/ui/contrast.test.ts`: read the token declarations out of `globals.css`, convert with `culori`, and assert 4.5:1 on every text pair in both themes and 3:1 on the focus ring and on meaningful borders. Adjust the palette until it passes; the test is authoritative, not the drafted values, satisfies **AC-2**
4. [x] Generate the `button` primitive, convert it to named exports, and give it every state including a pending state driven by `useFormStatus`, satisfies **AC-4**
5. [x] Add the reduced motion rule and the focus visible ring rule to `globals.css` as global rules, so no component has to remember them, satisfies **AC-5**, **AC-15**
6. [x] Build `setThemeAction` (Zod parsed, `Result` returning, cookie writing) and the `ThemeControl` pattern as a form that posts to it, working without JavaScript. Read the cookie in the root layout and stamp `data-theme`, satisfies **AC-8**, **AC-9**
7. [x] Rebuild `src/app/page.tsx` as the entry card on the real tokens, with Sign in linking to `/sign-in` and Create an agency linking to `/sign-up`, the exact paths feature 6 must then use, plus the theme control, satisfies **AC-17**, **AC-23**
8. [x] Add the axe helper for Vitest (`src/ui/test/axe.ts`) and an `@axe-core/playwright` check in `e2e/`, both configured with the same rule tags (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), pointed at what exists so far in both themes, satisfies **AC-19**
9. [x] Add a third job to `.github/workflows/ci.yml` for the browser suite: `pnpm exec playwright install --with-deps chromium` then `pnpm test:e2e`. The two existing jobs run no browser, so without this the Playwright half of AC-19 never runs on a push, satisfies **AC-19**
10. [x] Update the two tests this slice breaks: `src/app/layout.test.tsx` mocks `Geist` and asserts `--font-geist-sans`, and `src/app/page.test.tsx` asserts the `/api/health/db` link and the Foundation region that the new entry card removes. Change them alongside the code, not afterwards, satisfies **AC-17**

**Milestone 2: the primitives and the gallery**

11. [x] Generate the rest of the core set into `src/ui/primitives/`: `input`, `textarea`, `label`, `select`, `checkbox`, `switch`, `card`, `badge`, `table`, `dialog`, `sheet`, `dropdown-menu`, `alert`, `skeleton`, `tooltip`, `separator`, `avatar`, `breadcrumb`, `pagination`, plus the `sonner` toaster host. Convert each to named exports and check each state applies, satisfies **AC-4**
12. [x] Build the `field` wrapper: label, control, optional description, error slot, wiring `aria-invalid` and `aria-describedby` from a `Result` field error, satisfies **AC-13**
13. [x] Build `/design` as a gallery of every primitive in every state, in both themes side by side, returning `notFound()` in production, satisfies **AC-16**
14. [x] Point both axe suites at `/design` and at each primitive, and add a target size check on the densest example, satisfies **AC-19**, **AC-21**

**Milestone 3: the patterns**

15. [x] `status-chip`: the word plus a tint, with the full map for invoices, projects and deliverables taken from the real schema enums, plus the subscription access levels marked provisional in a comment naming feature 9 as their owner, satisfies **AC-11**
16. [x] `empty-state` and `error-state`, plus `error-messages.ts` mapping the closed `ACTION_ERROR_CODES` to plain sentences, then wire `error.tsx`, `not-found.tsx` and `global-error.tsx` to the error state. `global-error.tsx` supplies its own `html` and `body`, imports `globals.css` directly, stamps no theme, and uses the system font stack, because the root layout has not run when it renders, satisfies **AC-12**
17. [x] The `data-table` pattern over the `table` primitive: each column declares `priority: "high" | "low"`, low priority columns are removed from both the layout and the accessibility tree below `md`, and the row is made clickable by the stretched link technique in invariant 12 rather than by wrapping the row. Ship a fixture column set on `/design` shaped like a real invoice list (invoice number, client, amount and status high; issued date and created by low) so the behaviour is provable before feature 13 exists. Prove it at 320px, satisfies **AC-10**, **AC-21**
18. [x] The skeleton convention: a skeleton variant exported beside each component it stands in for, plus the `Suspense` and `loading.tsx` rules and the busy announcement, satisfies **AC-14**
19. [x] Mount the toaster host in the root layout and settle the toast rules: outcome only, dismissible, never the sole home of an error, satisfies **AC-13**

**Milestone 4: the shell and the real route**

20. [x] Wrap the app in `ClerkProvider` and add `src/proxy.ts` (the Next.js 16 name for what used to be `middleware.ts`) containing `export default clerkMiddleware()` with every route public, carrying a comment naming feature 6 as the owner of the matcher, satisfies **AC-18**
21. [x] Build `src/ui/shell/`: `app-shell`, `skip-link`, `sidebar-nav` with both groups, `aria-current` and the pinned paths from AC-23, `top-bar` with the breadcrumb slot and theme control, `agency-switcher` and `user-menu` as client components on Clerk's hooks with a skeleton while loading and a sign in prompt when signed out, satisfies **AC-6**, **AC-22**, **AC-23**
22. [x] Add the mobile sheet: labelled menu button below `md`, focus kept inside while open, `Escape` closes and returns focus, satisfies **AC-7**
23. [x] Create `src/app/(agency)/layout.tsx` rendering the shell, `src/app/(agency)/dashboard/page.tsx` with an empty dashboard body, and `src/app/(agency)/not-found.tsx` rendering the shared error state, so a sidebar link to a section that has not shipped yet lands on a proper page inside the shell rather than a bare 404. The route group keeps the flat paths spec 0001 fixed, satisfies **AC-22**, **AC-23**
24. [x] Point the Playwright axe suite at `/dashboard` in both themes, signed out, satisfies **AC-19**

**Milestone 5: write it down and prove the rest by hand**

25. [x] Write `design.md` at the repository root: the register and why, the type usage rules, both palettes with the ratios the contrast test computed, spacing and radius, the status tint map, every component and its states, the responsive rule, the accessibility rules, and the client portal chrome rules feature 15 builds to, satisfies **AC-1**
26. [x] Write `src/ui/AGENTS.md` as a thin pointer to `design.md` plus the area's own conventions and the relevant skills, satisfies **AC-1**
27. [ ] Complete the manual pass in `verify.md`: keyboard, screen reader, zoom to 200 percent, 320px reflow, and each WCAG 2.2 addition, recording the result, satisfies **AC-5**, **AC-20**, **AC-21**

## Consequences

**Positive**:

- Every feature from 6 onward builds screens instead of deciding type sizes, and `/develop` has a written answer rather than shadcn defaults.
- Contrast is machine enforced, so AC-2 stays true after the palette is tweaked in six months. This is the single highest value part of the feature and it is the part usually left as prose.
- The shell taking Clerk data through hooks keeps spec 0003's rule intact: `auth()` still lives in exactly one file.
- Dark mode decided on the server means no blocking script, no flash, and the theme is known wherever a Server Component renders.
- Owning the component source means an accessibility bug is a fix in your repository, not a wait on a vendor.
- `/design` gives `/check verify` and the axe suites something real to point at before any feature screen exists, which is what makes this feature verifiable at all.

**Negative and tradeoffs**:

- **The permissive middleware is a real hazard.** `clerkMiddleware()` with every route public will sit in `main` until feature 6 narrows it. It is harmless while `/dashboard` renders an empty body, and it becomes a data leak the moment a feature puts real rows behind an agency route without touching the matcher. The follow up below exists to stop that, and feature 6 must not be skipped.
- Wiring Clerk here takes work out of feature 6 and leaves that feature holding a half configured integration it did not set up. Feature 6's spec has to start by reading this one.
- The agency switcher and user menu are client components on Clerk's hooks, so the chrome loads a beat after the page. A skeleton covers it, but the top bar will visibly settle on a cold load. Reading identity server side would remove that and would break invariant 2.
- Building the switcher and user menu rather than using Clerk's own means agency creation and member management are not free, and feature 16 has to build or theme them.
- The teal accent sits about 34 degrees of hue from the paid green. They are distinguishable, and the chip carrying the word does the real work, but a redesign that moves either hue must recheck this.
- 4.5:1 with no large text exemption constrains the palette. The muted tier cannot be as quiet as the register would like, so hierarchy leans more on size and weight than on colour.
- The compact density fits more rows and is harder on anyone with low vision. Zoom to 200 percent is therefore a required check, not a nice one.
- CI gains a third job that installs a browser, so every push gets slower and the workflow grows a step that can fail for reasons unrelated to the change.
- Seven new dependencies, and the shadcn tool will add Radix packages per component. Each is small and well known, and it is still seven more things to keep current.
- Hand written contrast maths is avoided by taking `culori`, but the test still needs to know which token pairs are text pairs. That list is maintained by hand and can fall behind a new token.
- The native form pattern means no client side validation, so every invalid submission costs a round trip. Acceptable for an internal tool, and it will feel slow on the invoice line item form in feature 13.

**Neutral**:

- Reading the theme cookie in the root layout makes every route dynamic, so `/`, `/design` and `/dashboard` are rendered per request rather than at build time. That is the price of painting the right theme in the first frame, and it costs nothing real while every route in the product is behind a session anyway.
- The theme action reuses `Result`, `failure` and `ActionError` from `src/db/tenant/errors.ts`, so `src/ui/` now depends on a module living under `src/db/`. No lint rule forbids it, and it is a slightly odd home for a type the interface layer needs. See the follow up.
- No migration, no schema change, nothing for `db:generate` to produce.
- `src/ui/` becomes a fourth area alongside `src/app`, `src/db` and `src/lib`, and earns its own `AGENTS.md`.
- `components.json` will not match shadcn's published examples, because its aliases point at `src/ui/`. Copying a component from their docs means one path edit.
- `design.md` and `globals.css` say the same thing in two languages. The contrast test binds the colour half of them together; the type and spacing half is kept honest by review.
- The client portal chrome is written down here and built in feature 15, so it stays unproven until then.
- The Sign in and Create an agency buttons on `/` point at routes that do not exist yet and will not resolve until feature 6.

## Follow-up

- [ ] **Feature 6 must narrow the middleware matcher** so the agency route group requires a session, and it must do that before feature 7 puts real client rows behind it. Until then the agency area is public by design, not by accident.
- [ ] Consider adding a `clienthq/no-literal-colour` ESLint rule, in the shape of the existing `clienthq/no-raw-db-import`, so invariants 1 and 11 are enforced by the build rather than by review. It would need to catch both a raw hex value and an opacity modifier on a colour token, which is the case the contrast test cannot see. Cheap to write and it is the same category of rule the project already trusts.
- [ ] Agent Skills and MCP servers for `lucide-react`, `sonner` and `axe-core` were offered and deferred. A skill would teach the agent each tool's real conventions rather than letting it guess, which matters most for `axe-core`, where the difference between a passing rule set and a meaningful one is convention. Run the offer again whenever you want them.
- [ ] The installed skills `shadcn-ui`, `tailwind-design-system`, `responsive-design`, `wcag-audit-patterns`, `web-design-guidelines`, `design-system` and `react-patterns` are relevant here but are not named in any `AGENTS.md`. They are area scoped, so they belong in `src/ui/AGENTS.md` rather than root, which loads on every task. Task 24 creates that file; `/sync` owns writing it.
- [ ] Feature 9 owns the subscription access level names. This spec uses `full`, `grace`, `locked` and `unsubscribed` in the status tint map because the banner needs a tint before that feature exists. Feature 9 must either adopt them verbatim or change `status-chip.tsx` when it lands.
- [ ] The invoice PDF (feature 14) and transactional email (feature 10) were deliberately left out of this feature's reach. Both need a plain value export of the palette, because neither a PDF renderer nor an email client can read CSS variables. Decide that when those features are designed.
- [ ] Decide whether the theme control belongs in the top bar forever or moves into Settings once feature 16 builds one. It is in the top bar here because `/` and `/dashboard` are the only surfaces that exist.
- [ ] `Result`, `failure` and `ActionError` live in `src/db/tenant/errors.ts`, and this feature makes `src/ui/` import them. Consider moving that vocabulary to `src/lib/result.ts` and re exporting it from the tenant layer, so the shape every layer returns is not owned by the database area. Not urgent, and cheaper now than after fifteen features import it.
- [ ] No agency branding, white labelling or logo upload is modelled. The client portal shows ClientHQ's chrome, not the agency's. If agencies ask for their own logo in the portal, that is a new decision and it touches these tokens.
