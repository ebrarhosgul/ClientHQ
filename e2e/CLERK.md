# Signing the browser suite in

Written by spec 0005, build plan task 25. **The test itself is not written here**;
`/test` writes it. This is the documented way in, so whoever writes it does not
have to work it out again.

## Why the suite runs signed out today

`playwright.config.ts` starts the dev server with the two Clerk keys blanked, so
a local run behaves exactly like CI's browser job, which has no provider
credentials at all. Without a publishable key `src/proxy.ts` is a pass through
(see `src/lib/env.ts`), which is what keeps `/dashboard`, `/design` and the rest
reachable, and what lets someone clone this repository and look at it.

That covers everything except the one thing that matters most: a person actually
signing up, creating an agency, and landing on a dashboard that names it.

## What signing in needs

Three things, none of which is in the repository:

1. **A development instance.** Clerk testing tokens only work against a
   development instance, never production. That is also what lets the suite past
   the bot protection Clerk puts in front of sign up, which is otherwise
   unsolvable by an automated browser and must not be worked around.

2. **A dedicated user in that instance**, named by two environment variables that
   are already declared in `src/lib/env.ts` and `.env.example`:

   ```
   E2E_CLERK_USER_USERNAME=""
   E2E_CLERK_USER_PASSWORD=""
   ```

   Both optional, because nothing the application runs needs them. A suite that
   finds them unset should skip rather than fail, the way the database suites
   skip without `DIRECT_URL`.

   Give that user its own agency. Sharing one with a human's account makes a
   failing test look like someone else's data changed under it.

3. **`@clerk/testing`**, already a dev dependency. It has two halves: a global
   setup call that fetches a testing token for the instance, and a Playwright
   helper that performs the sign in without touching the UI.

## Where each piece goes

- The testing token setup belongs in `e2e/global-setup.ts`, beside the route
  warming that is already there. It needs `CLERK_SECRET_KEY` and
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in the *runner's* environment.
- The blanked keys in `playwright.config.ts` have to come off for the signed in
  project. Prefer a second Playwright project over changing the existing one, so
  the signed out suite, which is the whole of spec 0004's accessibility proof,
  keeps running exactly as it does now.
- Store the signed in state and reuse it, rather than signing in per test.

## What the signed in suite is for

The acceptance criteria no signed out run can reach, from spec 0005's
`verify.md`: AC-2, AC-5, AC-6, AC-7, AC-9, AC-15 and AC-16.

If the setup turns out to need more than the two variables above, record the
difference back in spec 0005, whose Follow-up section asks for exactly that.
