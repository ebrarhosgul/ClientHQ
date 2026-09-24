# 0021. Link styling: colour and weight instead of underline by default — rationale

## Context

Every clickable row, card value, and inline link in the product currently uses Tailwind's `underline` utility, copied by hand into each component: `underline underline-offset-2` in most places, `underline-offset-2 hover:underline` in a few others. Nothing in `design.md` or spec 0004 (design system and UI foundation) ever decided this; it is simply what got typed the first time and repeated. The result is two inconsistent conventions doing the same job, duplicated across roughly sixteen files with no shared class or component, and a classic "default browser link" look that reads as dated next to the rest of the token driven, deliberately designed surface.

The one real constraint is WCAG 2.2 AA's rule that a link must be distinguishable from the text around it by more than colour alone (root `AGENTS.md`: "every UI surface meets WCAG 2.2 AA"), enforced in this project by axe against real rendered routes. That rule only bites where a link sits inline, mixed into a sentence of plain text a reader has to tell apart from the link. Most links in this codebase are not that: a dashboard row link, a stat card's value, and a footer notice link each occupy an entire line or an entire value on their own, with nothing else sharing that line. A small number of links, today three call sites across two files, genuinely sit inline in a sentence (a cookie banner's "privacy notice", and a billing recovery link appended straight after an error sentence), and those cannot rely on colour alone in every theme: `--primary` measured against plain body text clears 3:1 in light mode but only 2.01:1 in dark mode, short of the WCAG technique's own floor.

This is a cross cutting decision because it touches a shared visual convention used everywhere, not one feature's screen.

## Options considered

### Option 1: Document the standard and migrate every file in one coordinated change

Define the two utilities, the new token, and the enforcement check, then update every current `underline` call site (the shadcn `link` variants plus the roughly sixteen hand written call sites) in the same change.

**Pros**:
- The product looks consistent the moment this ships; no page is left with the old look while another has the new one.
- One review, one set of axe and contrast runs, one point where the change either holds up or does not.

**Cons**:
- A single change touching that many files is a larger diff to review than a gradual rollout, even though each edit is a one line class swap.

### Option 2: Document the standard, enforce it for new code only, migrate existing files as tracked debt

Add the utilities and the enforcement check now, but only require new code to use them; existing files keep their current `underline` classes until someone happens to touch them.

**Pros**:
- Smallest single change; nothing existing breaks or needs review today.

**Cons**:
- Directly works against the actual goal, a cohesive dashboard look: the product would show both the old underline and the new treatment side by side for however long it takes every file to be touched again, which could be months.
- The enforcement check would need to special case every already-existing file as grandfathered, which is more bookkeeping than doing the migration once.

### Option 3: Document only, rely on code review

Write the spec and the intended class names, but add no automated check; reviewers are expected to catch a reintroduced `underline`.

**Pros**:
- No new test to write or maintain.

**Cons**:
- This project already enforces exactly this kind of design system rule automatically (`src/ui/token-discipline.test.ts` catches a literal colour or an opacity modifier the same way); relying on a human to catch a copy pasted `underline` class is a weaker version of a check the project already knows how to write and already trusts more than review for this class of mistake.

## Rationale

Option 1 is the only option that actually delivers what was asked: a cohesive look, not a look that is inconsistent for an unbounded stretch of time while files get touched one at a time (Option 2's real cost). The migration itself is low risk because every call site is a one line class swap with no logic change, so doing it once, reviewed once, is cheaper than the bookkeeping Option 2 would need to track which files are "old" versus "new" style. Automated enforcement (over Option 3) follows directly from how this project already treats every other design system rule: `token-discipline.test.ts` already exists and already runs in the same suite, so extending it is the boring, already trusted choice, not a new pattern to learn.

Splitting the token from `--primary` rather than reusing it directly is forced by how `contrast.ts` works: it reads the token's literal value out of `globals.css` and hands it to `culori` to compute a real contrast ratio, and `culori` cannot resolve a CSS `var()` reference, only a real colour. `--link: var(--primary)` would silently break the contrast test rather than measuring anything, so `--link` is declared with the same literal `oklch()` numbers as `--primary` in all three theme blocks instead, verified in this session to clear 4.5:1 against `--card` and `--background` in both themes (`--primary` already measures 5.25:1 light / 7.43:1 dark against `--card`, and `--link` copies those exact values). The inline exception keeps a line because the numbers rule out a colour only fix there for every theme: `--link` against `--foreground` plain sentence text measures 3.30:1 in light mode (clears the 3:1 WCAG technique floor) but only 2.01:1 in dark mode (fails it), and no colour this codebase's dark palette can render legibly against a dark card will close that gap, because `--foreground` in dark mode already sits near maximum lightness. A shape cue, not a colour choice, is the only fix available for a link genuinely inline in a sentence.

