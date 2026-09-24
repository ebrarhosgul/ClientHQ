# Verify: link styling · spec 0021 · updated 2026-09-24

_Steps derived from spec 0021's Standard definition and the scope's "Done when" line, which stand in for numbered acceptance criteria on this decision spec. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Visit `/design` in light mode → the dashboard row links, stat card values, invoice/project detail links and portal list links show teal `link-accent` text with no static underline, and a soft background highlight appears on hover and on keyboard focus → Done-when 1
- [ ] Repeat in dark mode (toggle `ThemeControl` or `[data-theme="dark"]`) → same treatment, still no static underline, still legible → Done-when 1
- [ ] In `/design`, tab to the `Button` `link` variant and the `Badge` `link` variant → both show the same `link-accent` colour and hover/focus background, the disabled `Button` link drops to the muted pair with no leftover underline artifact → Done-when 1
- [ ] Load a page that renders the cookie banner (first visit, no consent cookie) → the "privacy notice" link sits inline in the sentence and keeps a visible underline (`link-accent-inline`) → Done-when 2
- [ ] Trigger a `subscription_inactive` action error (an expired/canceled subscription attempting a gated write) → the "Go to billing" link keeps a visible underline (`link-accent-inline`) → Done-when 2

## Commands

- [ ] `pnpm vitest run src/ui/token-discipline.test.ts` → all pass, including the new "a link uses link-accent or link-accent-inline, not a raw underline" describe block → Done-when 3
- [ ] `pnpm vitest run src/ui/contrast.test.ts` → passes, including the new "link text on a card" pair in both themes → supports Done-when 1
- [ ] Temporarily add a raw `underline` class to any file outside `src/ui/patterns/action-error.tsx` / `src/analytics/ui/cookie-banner.tsx`, rerun `pnpm vitest run src/ui/token-discipline.test.ts` → it fails, then revert → proves Done-when 3's enforcement
- [ ] `pnpm typecheck` and `pnpm lint` → both clean

## Acceptance-criteria coverage

- Done-when 1 (every row/stat-card/standalone link uses `link-accent`, no static underline) … covered by the `/design` light/dark steps and the Button/Badge variant step
- Done-when 2 (the two inline links use `link-accent-inline`) … covered by the cookie banner and billing recovery link steps
- Done-when 3 (a Vitest check fails the build on a reintroduced raw `underline`) … covered by the token-discipline command steps
