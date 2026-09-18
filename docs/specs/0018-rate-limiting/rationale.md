# 0018. Rate limiting: rationale

The decision record for [index.md](index.md). `/develop` does not need this file; it is for the person deciding whether the decision still holds.

## Context

Spec 0001 listed rate limiting as a provider row (Upstash Redis, for invitation sends and upload URL signing) and then, in its own follow up, asked whether Upstash earned its place once the real scope was so small. Nothing was ever installed: `env.ts` has no `UPSTASH_*` entries and `@upstash/ratelimit` is not in `package.json`. Spec 0009 answered half the question on its own when it built invitations: a five minute per contact cooldown and a fifty a day per agency cap, both decided from the `invited_at` column, explicitly without Upstash. Spec 0003 reserved a `rateLimit?: never` slot on the action wrapper and the `rate_limited` error code so that the shape would not move when this feature landed, and spec 0004's message map already has a generic sentence for the code. Spec 0011 named `requestUpload` as the hook point and recorded, twice, that until this feature the only brakes on a hostile staff account filling the 10 GB R2 free tier are the 100 MB cap and the nightly sweep. Spec 0005 left agency creation unlimited and the scope carries that as a deferred item.

The forces are small numbers and a serverless runtime. The actions worth limiting are the ones that spend something outside the database: an R2 object, a Resend email (100 a day on the free tier, shared by every agency), a Clerk organization. Real usage is tens of uploads and a handful of invoices per agency per day. The app runs as Vercel functions, so an in memory counter is worthless: every instance would count alone. The database is reached through a transaction mode pooler, so whatever counts must work as plain statements with no session state. Spec 0017 now runs a nightly prune and a run ledger, which gives any bookkeeping table a place to be cleaned up. The scope row's "done when" fixes three things: a polite refusal with a clear message, limits per agency rather than global, and the limiter failing must not take the action down with it.

Not deciding means shipping to real agencies with an upload action that a script can call ten thousand times, and an invoice action that can empty the shared email quota in an afternoon.

## Options considered

### Option 1: Upstash Redis with `@upstash/ratelimit`, as spec 0001 sketched

Install the SDK, add the two REST variables, and call `Ratelimit.slidingWindow` with a per agency prefix before each limited handler. The skill for it is already installed.

**Pros**:
- Purpose built: sliding windows, analytics, ephemeral caching, all off the shelf.
- Keeps counting when Postgres is slow, so the limiter is independent of the thing it protects.
- Clerk, Vercel and many Next.js templates document exactly this pairing.

**Cons**:
- A ninth provider, two secrets in three environments, and an HTTP round trip on every limited call, to count numbers that never exceed a few dozen.
- The fail open path becomes real rather than theoretical: an Upstash outage or a bad token silently switches every ceiling off, and nothing but a log line says so.
- Spec 0001 itself flagged this as the provider to reconsider, and spec 0009 already declined it for the same feature.

### Option 2: A Postgres counter table with fixed clock windows and one atomic upsert (chosen)

One bookkeeping table keyed by `(subject, action, window_start)`. Each attempt is `insert ... on conflict do update set count = count + 1 returning count`; the attempt is allowed when the returned count is within the policy's limit. The wrapper's reserved slot takes a named policy, `createAgency` calls the same door with a person key, the refusal message carries a relative reset time, the door catches and fails open, and the nightly prune deletes rows older than a week.

**Pros**:
- No new provider, secret or network hop; the count lives beside the data it protects and travels with every environment for free.
- Exact under concurrency: the upsert is one statement, so two parallel calls cannot both read the same count, which fixes the class of bug spec 0009 noted in its own cap.
- Fits the project's existing patterns exactly: a named door in `src/db/tenant/` like `nextInvoiceNumber`, a bookkeeping table like `cron_runs`, a prune in the existing sweep, a policy declared in the wrapper config like `requireRole`.
- Fail open is honest: if the upsert throws, the database is in trouble and the action would most likely fail anyway.

**Cons**:
- A fixed window lets a burst across a boundary reach double the ceiling; a sliding window would not.
- The limiter shares fate with the database it protects, so it offers no protection during a database incident (though nothing else works then either).
- One more table, migration, schema assertion and prune to maintain.

### Option 3: Count existing rows, no new table

Spec 0009's trick applied everywhere: count `deliverables` created in the last hour, `invoice_events` of the notified kind today, `organizations` a person created today.

**Pros**:
- No schema change at all and no new module; each action already reads the table it would count.
- The count is derived from the real thing that happened, so it can never disagree with reality.

**Cons**:
- `abandonUpload` and `deleteDeliverable` hard delete their rows, so a script can request, abandon and repeat forever without the count ever rising; the option protects nothing for the action that matters most.
- Check then write with no lock, so every cap is off by the number of concurrent callers.
- Three different queries with three different shapes to keep correct, rather than one statement.

### Option 4: Sliding window in Postgres (a timestamp per attempt)

Same table idea but one row per attempt, counted over the trailing window.

**Pros**:
- No boundary burst; the ceiling holds over any 60 minute span.
- The reset time can be exact ("in 4 minutes, when your oldest attempt ages out").

**Cons**:
- A row per attempt instead of a row per window, and a count query on every call instead of a returning upsert; still check then write unless wrapped in a lock.
- The relative message it enables is not worth the extra shape at ceilings of 60 and 50.

## Rationale

The numbers decide it. Every ceiling here is double digits per hour or per day for an agency, and a serverless app needs a shared store either way; the question is only whether that store is the database the app already has or a second one. Spec 0001's own follow up, spec 0009's precedent and the project's rule that reuse beats sprawl all point the same way, and the atomic upsert makes the Postgres option better than the row counting shortcut, not merely cheaper than Upstash: it is exact where spec 0009's cap is not, and it survives hard deletes where Option 3 does not. The engineer took every recommendation in the walk: the four actions (uploads, the two invoice emails as one shared allowance, agency creation), per agency keys, attempts counted rather than successes, a message with the allowance and a relative reset, fixed clock windows, 60 an hour, 50 a day and 3 a day, fail open with a log line, the declarative slot, one table with a prefixed subject, and a seven day prune.

Three calls were settled here rather than asked, with the runner up. The consume runs on the pooled executor between parse and handler, never inside the action's transaction (runner up: inside it, rejected because a handler throw would roll the increment back and a retried loop would never be counted). `createAgency` consumes only after the existing agency short circuit, right before the Clerk create (runner up: at the top after the session check, rejected because a double click that resolves to the agency it already made would spend allowance for nothing). The refusal message rounds up to minutes under an hour and hours otherwise (runner up: a UTC clock time, rejected because no agency timezone exists and "after 00:00 UTC" is a bad sentence in Los Angeles). The subject is a prefixed text column rather than two nullable foreign keys (runner up considered and offered), because one primary key and one upsert serve both kinds today and an `ip:` kind tomorrow with no migration.

The engineer's pick to fail open was confirmed rather than challenged: with Postgres as the store the case is nearly theoretical, and the scope row asks for it explicitly. The one place the recommendation leaned against convenience was the dev switch: no environment variable disables the limiter, because the ceilings are generous enough that no local session or Playwright run approaches them, and a switch left on in production is a worse failure than a tedious test.
