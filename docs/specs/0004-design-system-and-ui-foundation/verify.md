# Verify: design system and UI foundation · spec 0004 · updated 2026-09-09

_Steps derived from spec 0004's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_The manual sections are not padding. Automated tooling catches roughly a third to a half of real accessibility problems, and almost none of what WCAG 2.2 added, so AC-20 is only met when those boxes are ticked by a person. Anything needing a real signed in Clerk session is marked **owed to feature 6**._

## Commands

- [ ] `corepack pnpm typecheck` → `Types generated successfully`, then no type errors, exit 0 → AC-3, AC-4
- [ ] `corepack pnpm lint` → no findings, exit 0, and no `any` or unchecked cast anywhere under `src/ui/` → AC-4
- [ ] `corepack pnpm test` → every file passes, including `src/ui/contrast.test.ts` and the per component axe assertions → AC-2, AC-4, AC-19
- [ ] `corepack pnpm vitest run src/ui/contrast.test.ts` → every text pair clears 4.5:1 in both themes, the focus ring clears 3:1 on both the page and the card, and the output prints each measured ratio → AC-2
- [ ] `corepack pnpm test:e2e` → the axe specs pass against `/`, `/dashboard` and `/design`, in both light and dark, with the rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` → AC-19
- [ ] `corepack pnpm build` → clean build, and `NODE_ENV=production corepack pnpm start` then `curl -o /dev/null -w "%{http_code}" http://localhost:3000/design` → `404` → AC-16
- [ ] Read `.github/workflows/ci.yml` → a third job exists that installs a browser and runs `pnpm test:e2e`. Without it the Playwright half of AC-19 never runs on a push → AC-19
- [ ] Push the branch → all three jobs pass, including the Vitest axe assertions, the contrast test and the Playwright axe specs → AC-19

## In the browser, both themes

Run `corepack pnpm dev` and check each in light and then in dark.

- [ ] Click a sidebar item whose feature has not shipped, such as Clients. The agency group's `not-found.tsx` renders the shared error state inside the shell, not a bare 404 → AC-23
- [ ] `/design` renders every primitive and every pattern listed in the component inventory, each showing default, hover, focus visible, active, disabled, invalid, loading and read only where the state applies → AC-4, AC-16
- [ ] `/` shows one centred card: product name, one line of description, a primary Sign in, a secondary Create an agency, and the theme control → AC-17
- [ ] `/dashboard` renders the shell: sidebar with Dashboard, Clients, Projects, Invoices in the primary group and Team, Billing, Settings in the quieter group, plus the top bar → AC-6
- [ ] Every status chip on `/design` shows its word as well as its tint. Squint or switch the display to greyscale: every status is still readable → AC-11
- [ ] The empty state and the error state render with a heading, one line, and an action or a way back. No stack trace, no error digest anywhere → AC-12
- [ ] Nothing on any of the three pages uses a colour, radius or spacing value that is not in the token scale. Spot check in DevTools: computed colours resolve to a `--` variable → AC-3

## Theme

- [ ] With no `clienthq_theme` cookie, the page follows the operating system setting. Flip the system setting while the page is open: the page follows with no reload → AC-9
- [ ] Choose Dark, then hard reload. The first painted frame is dark. Throttle the network in DevTools and reload again: still no flash of light → AC-8
- [ ] Choose Light while the system is set to dark. Reload. The page stays light, so the explicit choice wins → AC-8
- [ ] Choose System. The cookie is gone (DevTools, Application, Cookies) and the page follows the system again → AC-8
- [ ] Disable JavaScript in DevTools and use the theme control. It still changes the theme → AC-8
- [ ] In DevTools, set the cookie value by hand to `solarized` and reload. The page renders in the system theme rather than breaking → AC-8

## Keyboard, manual

- [ ] `Tab` once from a cold load on `/dashboard`: the first stop is the skip to content link, and it is visible → AC-6
- [ ] Activate the skip link: focus lands on the main content, not back at the top → AC-6
- [ ] `Tab` through the whole shell. The order matches the visual order, nothing is skipped, and nothing invisible receives focus → AC-5
- [ ] The focus ring is visible on every stop, against the page background, against a card, and against a primary button → AC-5
- [ ] Scroll the page so a focusable element sits under the sticky top bar, then `Tab` to it. It is not obscured. This is WCAG 2.2 rule 2.4.11 and no tool checks it → AC-5, AC-20
- [ ] Open a dialog. Focus moves inside, `Tab` cycles within it, `Escape` closes it, and focus returns to whatever opened it → AC-5
- [ ] The current sidebar item carries `aria-current="page"` (check in the accessibility tree, not the class list) → AC-6
- [ ] Nothing in the product requires a drag to operate. This is WCAG 2.2 rule 2.5.7 → AC-20
- [ ] Help is in the same place on every page, or absent from all of them. This is WCAG 2.2 rule 3.2.6 → AC-20
- [ ] No form asks again for information already given in the same flow, or if it must, it is prefilled or selectable. This is WCAG 2.2 rule 3.3.7. There are no multi step flows yet, so record this as not applicable with the reason → AC-20

## Screen reader, manual

Use VoiceOver on macOS (`Cmd+F5`) or NVDA on Windows.

- [ ] Every control on `/design` is announced with a name that says what it does, not just its type → AC-4
- [ ] A skeleton region is announced as busy, and the placeholder shapes themselves are not read out → AC-14
- [ ] A field error is announced when it appears, without moving focus → AC-13
- [ ] A toast is announced once, and the same information is also available somewhere that persists → AC-13
- [ ] The mobile navigation sheet announces its open and closed state → AC-7
- [ ] The status chip is announced as its word, not as a colour or a decoration → AC-11

## Responsive, zoom and motion

- [ ] At a 320px viewport width, no page scrolls horizontally. The invoice table on `/design` shows only its high priority columns → AC-10
- [ ] The hidden columns are gone from the accessibility tree too, not merely hidden with CSS → AC-10
- [ ] Below `md`, the sidebar is a labelled menu button that opens a sheet. Focus stays inside it, `Escape` closes it, focus returns to the button → AC-7
- [ ] Zoom the browser to 200 percent. Nothing is clipped, nothing overlaps, and no content is lost. The compact density makes this the check most likely to fail → AC-20
- [ ] Zoom to 400 percent at a 1280px window (equivalent to 320px reflow). Content reflows into one column → AC-10, AC-20
- [ ] Measure the inline action buttons on a table row in DevTools. Each is at least 24 by 24 CSS pixels, or has the spacing WCAG 2.2 rule 2.5.8 allows instead → AC-21
- [ ] `Tab` through one table row. The row link and each action button are separate stops with distinct names, and no button sits inside the row link → AC-10, AC-21
- [ ] Enable reduced motion (macOS System Settings, Accessibility, Display, Reduce motion; or DevTools rendering emulation). Open a dialog and the mobile sheet: neither animates → AC-15

## Code level checks

- [ ] `grep -rn "#[0-9a-fA-F]\{3,8\}\|rgb(\|hsl(" src/ui src/app --include=*.tsx --include=*.ts` → no hits outside `src/app/globals.css` → AC-3, invariant 1
- [ ] `grep -rnE "(bg|text|border|ring|fill|stroke)-(primary|secondary|accent|destructive|success|warning|info|muted|foreground|background|border|ring)[a-z-]*/[0-9]" src/ui src/app` → no hits. An opacity modifier on a colour token would slip past the contrast test → AC-2, invariant 11
- [ ] `grep -rn "from \"@clerk/nextjs/server\"" src/ --include=*.ts --include=*.tsx` → one hit only, `src/db/tenant/session.ts`. The shell reads identity through React hooks, so spec 0003's rule is intact → AC-18, invariant 2
- [ ] `grep -rn "tenantDb\|withTenantAction\|@/db" src/ui/` → no hits. The shell runs no query and resolves no tenant context → invariant 3
- [ ] `grep -n "export default" src/ui/primitives/*.tsx src/ui/patterns/*.tsx src/ui/shell/*.tsx` → no hits → invariant 10
- [ ] Read `src/proxy.ts` → it exists at that name (not `middleware.ts`, which Next.js 16 renamed), exports `clerkMiddleware()` as its default, leaves every route public, and carries a comment naming feature 6 as the owner of the matcher that will protect the agency routes → AC-18
- [ ] Read `src/app/globals.css` → the light palette on bare `:root`, the dark overrides inside `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`, and the dark overrides again under `:root[data-theme="dark"]`. All three present → AC-8, AC-9
- [ ] Read the theme action → the input is Zod parsed, the failure comes back as a `validation` `Result` from `src/db/tenant/errors.ts` rather than thrown or a newly invented code, and the cookie is set `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, one year → AC-8
- [ ] Read `src/app/global-error.tsx` → it supplies its own `html` and `body`, imports `globals.css` directly, stamps no `data-theme`, and uses the system font stack, because the root layout has not run when it renders → AC-12
- [ ] Read `src/app/(agency)/not-found.tsx` → it renders the shared error state inside the shell → AC-23
- [ ] Read `src/ui/shell/sidebar-nav.tsx` → the hrefs are exactly `/dashboard`, `/clients`, `/projects`, `/invoices`, `/team`, `/billing`, `/settings`, and `src/app/page.tsx` links to `/sign-in` and `/sign-up`. Feature 6 and every later feature must match these → AC-23
- [ ] Read the `data-table` pattern → `priority` is the two value union `"high" | "low"`, and the row is made clickable by a stretched link in the identifying cell rather than by an `<a>` wrapping the row → AC-10, invariant 12
- [ ] Read `design.md` → every section AC-1 lists is present, and each recorded contrast ratio matches what `src/ui/contrast.test.ts` prints → AC-1, AC-2
- [ ] `src/ui/AGENTS.md` exists and points at `design.md` rather than repeating it → AC-1

## Value sourcing

Each row of spec 0004's value sourcing table has one named source. Confirm the two that are easiest to get wrong:

- [ ] The breadcrumb is a slot the shell renders and each feature fills. The shell does not derive labels from path segments → AC-6
- [ ] Each skeleton variant is exported beside the component it stands in for, so a component change and its placeholder move together → AC-14

## Owed to feature 6

These cannot be run until sign in exists.

- [ ] Signed in at `/dashboard`, the top bar shows the real agency name, the real list of agencies in the switcher, and the real user in the user menu → AC-22
- [ ] Switching agency in the switcher changes the active organization, and the next server render sees it → AC-22
- [ ] Signed out at `/dashboard`, the shell renders with a sign in prompt in place of the switcher and user menu, and nothing crashes. This one **can** be run now → AC-22
- [ ] The Sign in and Create an agency buttons on `/` resolve rather than 404 → AC-17
