# UI

## Overview

Everything the product looks like: the design tokens, the component set, the
agency shell and the accessibility machinery that keeps them honest. Settled by
[spec 0004](../../docs/specs/0004-design-system-and-ui-foundation/index.md).

**Read [design.md](../../design.md) at the repository root before building any
screen.** It holds the register, the type and spacing rules, both palettes with
their measured contrast, the status tint map, the layout rules and the
accessibility rules. This file is the area's own conventions; that one is the
system.

## Key files

| File | Owns |
|---|---|
| `src/app/globals.css` (outside this area) | Every token value. The three state theme pattern, the one focus ring, the reduced motion rule and the `transition-surface` utility |
| `src/ui/contrast.ts` | The colour maths, and the list of pairs that get measured |
| `src/ui/contrast.test.ts` | Reads `globals.css` and fails when a pair drops below its floor |
| `src/ui/token-discipline.test.ts` | Catches a literal colour, an opacity modifier on a token, or a component declaring its own focus ring |
| `src/ui/theme.ts`, `theme-action.ts` | The theme cookie and the one Server Action that writes it |
| `src/ui/primitives/` | The shadcn generated component set, brought in line with this system |
| `src/ui/patterns/` | Compositions: status chip, empty and error states, page header, data table, theme control, brand |
| `src/ui/shell/` | The agency chrome, and `navigation.ts`, which fixes every path the product commits to |
| `src/ui/test/axe.ts` | The Vitest accessibility helper and the shared rule tags |
| `e2e/axe.ts` | The same rules against real rendered routes |
| `src/app/design/` | The gallery: every component, every state, both palettes |
| `components.json` (repo root) | The shadcn config. Its aliases point at `src/ui/`, so a component copied from shadcn's docs needs one path edit |

## Rules

These are the ones that bite. The full set is in `design.md`.

- **Every colour comes from a token in `globals.css`.** No hex, no `rgb()`, no
  Tailwind palette name like `text-white` or `bg-slate-100`: those do not move
  with the theme, so they are right in one palette and wrong in the other.
- **No opacity modifier on a colour token.** `bg-primary/10` and `ring-ring/50`
  are forbidden. A faded token is a colour declared nowhere, so
  `contrast.test.ts` cannot see it. A tint is always its own explicit
  background and foreground pair; add one to `globals.css` if you need one.
- **No component declares a focus ring.** `globals.css` has one, unlayered so
  it beats every utility. `outline-none` anywhere would delete it.
- **`transition-surface`, not `transition-colors`.** Tailwind's utility includes
  `outline-color`, which makes the focus ring fade in from the text colour.
- **A disabled control drops to the muted pair**, not `opacity-50`. Faded text
  is exempt from the contrast rules and still unreadable.
- **The shell is chrome.** It runs no query, resolves no tenant context and
  decides no permission. It reads identity through Clerk's React hooks; the
  server side `auth()` lives only in `src/db/tenant/session.ts` (spec 0003).
- **Named exports only**, except where a framework file convention requires a
  default: pages, layouts, `src/proxy.ts`.
- **Add every new component to `/design`**, in every state it has, and give it
  an axe test in both themes.

## Adding a shadcn component

```bash
corepack pnpm dlx shadcn@latest add <name>
```

It writes into `src/ui/primitives/` and then needs four fixes, every time:

1. the import becomes `from "@/ui/lib/cn"` (the tool writes `from "cn"`);
2. opacity modifiers become declared tokens (`hover:bg-primary/90` →
   `hover:bg-primary-hover`);
3. its `focus-visible:ring-*` and `outline-none` classes come out;
4. `disabled:opacity-50` becomes
   `disabled:border-border disabled:bg-muted disabled:text-muted-foreground`.

## Commands

```bash
corepack pnpm test                       # includes contrast, token discipline and component axe
corepack pnpm vitest run src/ui          # just this area
corepack pnpm test:e2e                   # axe against /, /design and /dashboard in both themes
corepack pnpm dev                        # then open /design
```

## Gotchas

- **`/design` needs no session and no database.** It renders fixtures. It
  returns not found in production.
- **Clerk is optional in development.** With no publishable key the root layout
  skips `ClerkProvider` and the shell renders its signed out state, which is why
  the browser suite runs in CI with no provider credential. Set
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to see the real
  agency name and user menu.
- **Two dev servers cannot share `.next`.** Running `pnpm dev` while
  `pnpm test:e2e` starts its own server on port 3100 makes the second one fail
  to boot. Stop one first.
- **`ThemeControl` is an async server component.** A component test that renders
  something containing it has to mock it, or await it directly.

## Agent skills

- [shadcn](../../.agents/skills/shadcn/) and
  [shadcn-ui](../../.agents/skills/shadcn-ui/): the component tool and its
  conventions
- [tailwind](../../.agents/skills/tailwind/) and
  [tailwind-design-system](../../.agents/skills/tailwind-design-system/):
  Tailwind v4 and token design
- [accessibility-compliance](../../.agents/skills/accessibility-compliance/) and
  [wcag-audit-patterns](../../.agents/skills/wcag-audit-patterns/): WCAG 2.2 AA
  patterns and audits
- [responsive-design](../../.agents/skills/responsive-design/): container
  queries, fluid type, breakpoint strategy
- [web-design-guidelines](../../.agents/skills/web-design-guidelines/): a UI
  review checklist
- [react-patterns](../../.agents/skills/react-patterns/) and
  [vercel-react-best-practices](../../.agents/skills/vercel-react-best-practices/):
  composition and performance
- [clerk-react-patterns](../../.agents/skills/clerk-react-patterns/): the hooks
  the shell reads identity through
