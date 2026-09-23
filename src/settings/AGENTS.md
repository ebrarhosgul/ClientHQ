# Settings

## Overview

The agency's own business profile, shown read only at `/settings`: name, default currency, description, tax ID and postal address. There is no form and no Server Action yet; editing is a later feature. The data is eight nullable columns on `organizations` (migration `drizzle/0006_stormy_living_mummy.sql`).

## Key files

| File | Owns |
|---|---|
| `src/app/(agency)/settings/page.tsx` | The route. Resolves the agency context, reads the profile, renders the view |
| `src/settings/ui/settings-view.tsx` | The page body, including its "not set" and "could not be loaded" states |
| `src/settings/format.ts` | Pure display rules: `addressLines` drops whatever is blank, `currencyLabel` falls back to the bare code |
| `src/db/tenant/organization.ts` | `agencySettings(ctx)`, the reader behind the page |

## Conventions

- `/settings` sits outside the `(gated)` route group, next to `/billing`, on purpose: a lapsed agency can still see who it is.
- `agencySettings` is a separate reader from `agencyProfile`. `agencyProfile` is on the invoice and portal paths and carries only what they print; keep the business details off it.
- The profile columns are display only. Nothing here is copied onto an invoice, and the PDF still prints the agency by name only.
- Every profile column is nullable and `AgencySettings` exposes them as `string | undefined`. A new agency has filled in none, and the Clerk `organization.created` handler knows none of them.
- With no Clerk publishable key there is no session to resolve, so the page renders its "could not be loaded" state instead of calling `agencyContext()`.

_Drafted by /sync from the introducing change, worth a quick human pass._
