# 0004. Design system and UI foundation, rationale

The reasoning behind [index.md](index.md). `/develop` does not read this file.

## Context

> ⚠️ Premise note: this feature now wires Clerk, which is feature 6's job. You chose that deliberately, so that the shell shows a real agency name rather than fixtures, and the trade is a fair one. The failure mode it opens is specific and worth naming: `clerkMiddleware()` with every route public will sit in `main` for as long as it takes feature 6 to land, and if any feature puts real tenant rows behind an agency route without narrowing that matcher first, those rows are readable by anyone with the URL. It is harmless in this feature because `/dashboard` renders chrome and an empty body. The right framing is that this feature owns the provider and a deliberately permissive matcher, feature 6 owns the matcher that protects anything, and feature 7 must not start until feature 6 has done that. This is written into the security model, the negative consequences and the first follow up so it cannot be forgotten quietly.

Nothing about the product's appearance is decided. `src/app/globals.css` still holds the two token Next.js starter, `src/app/page.tsx` is a placeholder whose own comment defers to this feature, there is no `design.md` and no `components.json`. Spec 0001 chose Tailwind CSS v4 with shadcn/ui as the layer and then explicitly deferred the direction to a dedicated pass, so that `/develop` would not be left inventing a look from defaults. So the library question is settled and the open questions are the visual direction, which primitives exist, what the shell is, and how the accessibility bar is held.

Three forces shape it. First, two audiences share one codebase. Agency staff live in this app all day, working through lists of clients, projects, deliverables and invoices, so density and scanability matter more than charm. Client contacts see the portal occasionally, and what they see reflects the agency that is billing them, so it cannot look like an internal admin tool. Second, WCAG 2.2 AA on every surface including empty and error states is a project rule, not an aspiration, which makes accessibility a build constraint on tokens and components rather than an audit that happens afterwards. Third, the data is dense and tabular. Invoices carry line items, projects carry deliverables, and almost every screen in the roadmap is a list. A design system tuned for marketing pages would be the wrong tool.

Two more constraints bound the answer. One person is building this on free and student tiers, so anything with an operational cost or a build pipeline of its own is expensive in the only currency that is short. And this feature sits in Foundation, before the walking skeleton, which means it has to be verifiable with no real screens and no way to sign in. A design system that can only be checked once feature 7 exists is a design system that ships unchecked.

The cost of not deciding is concrete and already priced by spec 0001: fifteen later features each invent their own spacing, their own empty state, their own error copy and their own idea of what a focus ring looks like, and the retrofit is every screen at once.

## Options considered

### Option 1: Tailwind only, components written by hand

Keep tokens in `globals.css`, write every component from scratch on Tailwind utilities, add no component library at all.

**Pros**:

- Fewest dependencies of any option, and total control over every line.
- No vendor conventions to learn or work around, and the bundle carries only what was written.

**Cons**:

- An accessible select, dialog, dropdown menu and tooltip are each genuinely hard: focus trapping, focus return, typeahead, `aria-activedescendant`, escape handling, scroll locking, portal placement. Getting them right by hand is weeks, and getting them subtly wrong is invisible until a screen reader user hits it.
- It is the reinventing something hard failure pattern applied to accessibility, and the project rule is WCAG 2.2 AA on every surface.
- Contradicts spec 0001, which already chose shadcn/ui.

### Option 2: shadcn/ui, token first, written down, proved on a gallery (chosen)

Extend shadcn's own semantic token names, declare them once in Tailwind v4's `@theme` as OKLCH, generate the base components into `src/ui/` as source you own, write the direction and the rules into a root `design.md`, and prove the whole chain on a `/design` gallery plus a real `/` and `/dashboard`.

**Pros**:

- The hard accessibility work in the primitives comes from Radix, which is maintained by people who do this full time, and the source lands in the repository so a bug is a fix rather than a wait.
- No runtime dependency on a component library and no version lock, which is what spec 0001 chose it for.
- The gallery makes the feature verifiable now, with no sign in and no feature screens, which is the only way a Foundation row can be checked.
- Tokens declared once mean the contrast floor can be machine checked, so the accessibility claim survives a later palette tweak.

**Cons**:

- The most work of the three viable options: about twenty five build tasks, a written document, and a contrast test with real colour maths in it.
- `design.md` and `globals.css` describe the same system twice and can drift. The contrast test binds the colour half; the rest relies on review.
- Owning the source means owning the upgrades. A shadcn improvement is a manual re copy, not a version bump.

### Option 3: A packaged component library

Take a maintained library such as MUI, Mantine, Chakra or Radix Themes, theme it, and build on its components.

**Pros**:

- Fastest to a working, accessible, consistent interface, by a wide margin.
- Accessibility and browser quirks are somebody else's ongoing job, and upgrades arrive as a version bump.
- Comes with the pieces this option would otherwise defer, including a date picker and a data table.

**Cons**:

- A runtime dependency and a version lock on the product's entire appearance, which is exactly what spec 0001 rejected.
- Theming happens through the vendor's API, so the look is always the library's look wearing your colours, and escaping it later is a rewrite.
- A large bundle relative to what a compact internal tool actually uses.

### Option 4: Defer, let features 6 and 7 establish patterns

Build no foundation. Let the first real screens set the conventions, and extract a system later once there is something to extract from.

**Pros**:

- Zero cost now, and the patterns that emerge are grounded in real screens rather than guessed at.
- Nothing is built that turns out to be unnecessary.

**Cons**:

- Precisely what spec 0001 forbade, for the stated reason that `/develop` would invent a look from defaults.
- Extraction after the fact is the expensive direction. Every screen already written has to change, and in practice the first screen's accidental choices become the system.
- Accessibility retrofitted per screen is how a project ends up with a focus ring on some components and not others.

## Rationale

Option 2 because two of the three forces in Context point at it and the third rules out the alternatives. The density force means the system has to be tuned for tables the product actually has, which a packaged library will not do for you and which is cheap to do yourself once the tokens are yours. The accessibility force rules out Option 1 outright: writing an accessible dialog and select by hand is the reinventing something hard pattern, and it is the same instinct spec 0001 already refused when it chose not to build auth. And the Foundation position, verifiable with no real screens, is what makes the extra work of Option 2 worth paying rather than deferring: the gallery route is the only surface on which this feature can be proved at all, and it exists in no other option.

Option 3 is the honest runner up and would have been the right answer for a team shipping under deadline. It loses on spec 0001's own reasoning, which is that owning the component source is the point of shadcn/ui, and on the two audience force: a packaged library's look is the library's, and the client portal is the surface where that matters most.

You chose a teal accent after being told it collides with a paid green, and that choice stands. It is resolved rather than overridden: the two hues sit about 34 degrees apart in OKLCH, the brand appears on buttons and links while green appears only inside status chips, and every chip carries its word so the tint is reinforcement and never the signal. That satisfies the never colour alone rule anyway, which is why the collision was a legibility concern rather than a compliance one. The one thing it costs is a constraint recorded for later: moving either hue means rechecking the pair.

Two smaller calls were made rather than asked. The theme control became a three item menu (System, Light, Dark) rather than a two state switch, because a two state switch has no way back to following the operating system once it has been touched, and the dropdown primitive it needs is already in the core set, so the better answer was nearly free. And the theme cookie became `httpOnly`, contrary to a remark made during the interview: because a Server Action writes it and the server renders from it, the browser never needs to read it, so there is no reason to leave it script readable.

## Evidence: palette drafting notes

The starting values in `index.md` were drafted, not measured. They are chosen to land near their floors so the contrast test has room to move them in either direction, and the test is authoritative.

- **Warm neutrals** are OKLCH hue 70 at chroma 0.002 to 0.010. Low enough to read as grey, high enough that the greys are not clinical. Pure neutral (chroma 0) is the cool crisp register that was not chosen.
- **The muted foreground is the risk.** In light, `oklch(0.47 0.010 70)` on `oklch(0.994 0.002 70)` is the pair most likely to sit near 4.5:1, and it also has to clear the floor on the `--muted` surface, which is lighter than the page. Both pairs are asserted, not just the page one. In dark the mirror pair is `oklch(0.715 0.010 70)` on `oklch(0.175 0.006 70)`.
- **The primary is a background, not text.** In light, `oklch(0.52 0.09 182)` is chosen so near white text on it clears 4.5:1. In dark the roles flip: `oklch(0.72 0.11 182)` with dark text, because a dark accent on a dark ground cannot carry light text at this chroma.
- **Hue separation** across the status tints: neutral 70, success 148, info 250, warning 75 to 80, destructive 27, brand 182. Warning at 75 sits close to the neutral hue, which is fine because warning always arrives at much higher chroma. Success at 148 against brand at 182 is the pair to watch, and it is the one the word on the chip protects.
- **Chip tints are pairs, not opacities.** A tint made by fading a solid colour against an unknown background cannot be contrast checked, so each chip gets an explicit background and foreground token per theme, and both go in the test.
- **The focus ring is checked against two backgrounds**, the page and the card, because a ring that clears 3:1 on white can fail on a raised surface, and cards are where most focusable things live.
