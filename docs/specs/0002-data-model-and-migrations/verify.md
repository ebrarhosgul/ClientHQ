# Verify: Data model & migrations · spec 0002 · updated 2026-09-06

_Steps derived from spec 0002 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Every step needs `DIRECT_URL` pointing at a PostgreSQL you may write to. On this machine that is the Supabase dev project from `.env` (copy it into a worktree first). A step marked "fresh database" wants an empty `public` schema; drop the eleven tables and the `drizzle` schema first if the dev project already carries them.

## Commands

- [ ] Fresh database: `pnpm db:migrate` → exits zero, prints `migrations applied successfully` → AC-1
- [ ] Same database: `pnpm db:migrate` again → exits zero, applies nothing → AC-1
- [ ] `pnpm db:schema:assert` → prints `100 of 100 expectations hold` (eleven tables, every unique, CHECK and index, every foreign key `ON DELETE` read from `pg_constraint.confdeltype`) → AC-2, AC-6, AC-8
- [ ] `pnpm db:migrate:check` on a clean checkout → both lines `ok` → AC-7
- [ ] Add `export const zz = pgTable("zz", { id: text("id").primaryKey() });` to a new file in `src/db/schema/`, run `pnpm db:migrate:check` → `FAIL`, names the migration generating would add; delete the file → AC-7
- [ ] `pnpm vitest run src/lib/money.db.test.ts` → 14 rounding cases pass against PostgreSQL → AC-3, AC-5
- [ ] `pnpm typecheck` and `pnpm lint` → both clean; `grep -rn "as any\|: any" src/db/schema src/lib/money.ts src/lib/scrub.ts scripts/db-seed.ts` → no matches → AC-10
- [ ] Without `SEED_ALLOW_HOST`, `DIRECT_URL` on a non local host: `pnpm db:seed` → exits 1 with `Refusing to seed <host>`; row counts unchanged → AC-9
- [ ] `SEED_ALLOW_HOST=<host> pnpm db:seed` twice → same counts both times: 1 organization, 4 users, 2 memberships, 1 subscription, 3 clients, 4 contacts, 3 projects, 4 deliverables, 5 invoices, 9 line items → AC-9
- [ ] After seeding: `select status, count(*) from invoices group by 1` → one each of draft, sent, paid, overdue, void → AC-9

## Database (run in a transaction and roll back, so the dev data stays clean)

- [ ] Insert an invoice with `total_cents <> subtotal_cents + tax_cents` → rejected, `invoices_total_check` → AC-5
- [ ] Insert an invoice with `tax_rate_bp = 10001` → rejected, `invoices_tax_rate_bp_check` → AC-5
- [ ] Insert an invoice with `currency = 'usd'` → rejected, `invoices_currency_check` → AC-5
- [ ] Insert a draft invoice with `paid_at` set, and a `paid` invoice with `paid_at` null → both rejected, `invoices_paid_at_check` → AC-5
- [ ] Insert an invoice with `subtotal_cents = 25, tax_rate_bp = 1500, tax_cents = 4, total_cents = 29` → accepted (3.75 rounds to 4); with `tax_cents = 3` → rejected → AC-5
- [ ] Insert an invoice with `subtotal_cents = 1000000000, tax_rate_bp = 10000, tax_cents = 1000000000, total_cents = 2000000000` → accepted, no integer overflow in the CHECK → AC-5
- [ ] Insert a line item with `quantity = '0.500', unit_amount_cents = 1, amount_cents = 1` → accepted; with `amount_cents = 0` → rejected, `invoice_line_items_amount_check` → AC-5
- [ ] Insert a line item with `unit_amount_cents = -5` → rejected, `invoice_line_items_money_non_negative_check` → AC-5
- [ ] Insert a user or contact with `email = 'Ada@x.com'` → rejected, `*_email_lowercase_check` → AC-5
- [ ] Two transactions in parallel, both READ COMMITTED, each running `update organizations set next_invoice_number = next_invoice_number + 1 where id = $1 returning next_invoice_number` then inserting a `sent` invoice with that number → both commit with consecutive numbers → AC-4
- [ ] Insert a second invoice with an existing (`org_id`, `number`) → rejected, `invoices_org_id_number_unique` → AC-4
- [ ] Delete a client that has an invoice → rejected, `invoices_client_id_clients_id_fk`; a client with a project → rejected, `projects_client_id_clients_id_fk` → AC-6
- [ ] Delete a project that has a deliverable → rejected, `deliverables_project_id_projects_id_fk` → AC-6
- [ ] Delete an invoice with line items → line items gone → AC-6
- [ ] Delete an organization with memberships → memberships gone → AC-6
- [ ] Insert contacts `ada@example.com` under client A and client B → both accepted; a second under client A → rejected, `client_contacts_client_id_email_unique`; two contacts sharing one `user_id` → accepted → AC-11
- [ ] Call `scrubUser(db, id)` on a user who uploaded a deliverable → returns `ok`, row has `deleted_at` set, `email = deleted+<id>@invalid`, `name = Deleted user`, `image_url` null; `deliverables.uploaded_by_user_id` still joins to the row → AC-12
- [ ] `select column_name, data_type, character_maximum_length, numeric_precision, numeric_scale from information_schema.columns where table_name in ('invoices','invoice_line_items') and column_name in ('currency','quantity','subtotal_cents','amount_cents')` → `character(3)`, `numeric(12,3)`, `integer`, `integer` → AC-3

## Value sourcing (one step per row of the spec's table)

- [ ] `newId()` twice in a row → two different strings, version nibble `7`, the second sorts after the first → Any insert, `id`
- [ ] `org_id` on every seeded tenant row equals the seeded organization's `id`, an internal uuid, never the Clerk id string → Any tenant scoped insert, `org_id`
- [ ] Set `organizations.default_currency = 'EUR'`, insert an invoice draft copying it → `currency = 'EUR'`; change the organization back to `USD` → the invoice still says `EUR` → Create an invoice draft, `currency`
- [ ] `lineAmountCents("2.5", 1000)` → 2500; `lineAmountCents("1e3", 1)` and `lineAmountCents("-1", 1)` → throw → Add a line item, `amount_cents`
- [ ] Insert two line items on one invoice with `position = 1` → second rejected, `invoice_line_items_invoice_id_position_unique` → Add a line item, `position`
- [ ] `invoiceTotals([1500, 2500, 1], 2000)` → `{ subtotalCents: 4001, taxCents: 800, totalCents: 4801 }` → Recalculate an invoice
- [ ] The concurrent issue step above → Issue an invoice, `number`
- [ ] Insert an issued invoice with `issue_date = '2026-09-06'` from the application while the database session is in a different timezone → stored day is `2026-09-06` unchanged (a `date`, not an instant) → Issue an invoice, `issue_date`
- [ ] `select id from invoices where status = 'sent' and due_date < '2026-09-06'` on the seed → returns none (the seeded overdue one is already `overdue`); with `'2026-09-20'` → returns the sent invoice → Overdue sweep
- [ ] `processed_webhook_events.source` accepts only `stripe` and `clerk`; `(source, event_id)` inserted twice → second rejected → Handle a webhook, ledger `source`
- [ ] `explain select id from processed_webhook_events where processed_at < now() - interval '90 days'` → uses `processed_webhook_events_processed_at_idx` → Prune the ledger
- [ ] `scrubbedUserFields(id)` → `deleted+<id>@invalid`, `Deleted user`, image undefined → Scrub a deleted user
- [ ] Seed twice, then `select count(*) from invoices` → 5 both times, ids identical → Seed, every `id`

## CI

- [ ] Open a pull request → the `Apply migrations to a fresh PostgreSQL` job runs on `postgres:17`, migrates twice, asserts the schema, runs the rounding test → AC-8
- [ ] After adding the `DIRECT_URL` and `VERCEL_DEPLOY_HOOK_URL` repository secrets and a Vercel Deploy Hook for `main`, merge to `main` → `Migrate and deploy` runs migrate first, then calls the hook; Vercel's automatic deploy for `main` stays off per `vercel.json` → AC-13
- [ ] Break a migration on a branch merged to `main` (or run the workflow with a bad `DIRECT_URL`) → migrate job fails, deploy job is skipped → AC-13

## Acceptance-criteria coverage

- AC-1 · fresh migrate, second migrate · AC-2 · schema assert · AC-3 · rounding test, column types · AC-4 · concurrent issue, duplicate number · AC-5 · the CHECK steps · AC-6 · the delete steps, schema assert · AC-7 · drift check pass and fail · AC-8 · schema assert, container job · AC-9 · seed refusal, seed twice, status spread · AC-10 · typecheck, lint, grep · AC-11 · contact steps · AC-12 · scrub step · AC-13 · migrate and deploy workflow
