/**
 * Seed a development database with a working agency, "Apex Interactive
 * Studio", and wipe whatever an earlier seed left behind first.
 *
 * Run it with `pnpm db:seed`. What Apex has, all backdated across the last 60
 * days from the moment the seed runs so nothing looks generated in one second:
 *
 * - Its own profile on `organizations` (address, tax ID, currency) for
 *   `/settings`, and an active subscription.
 * - Three staff, one admin and two members, in the `users` and `memberships`
 *   mirror. Note that `/team` reads live from Clerk (spec 0016), so these rows
 *   do not appear there: a seeded person has no Clerk account.
 * - Two clients. Northstar Cloud Solutions has two projects (one in progress,
 *   one delivered); Harbor Lane Capital has one, in review.
 * - Ten deliverables, six ready and shared with the client, three ready and
 *   internal, one still pending. Each ready one has real bytes
 *   (`scripts/seed-files.ts`), uploaded to R2 after the database write when R2
 *   is configured.
 * - Four invoices, one per state that matters: `paid` with its full history,
 *   `sent` and still open, `overdue` by four days, and an unnumbered `draft`
 *   only staff can see. Every line item is hours at an hourly rate.
 * - Accepted portal contacts at both clients, one still pending invitation,
 *   and one test person, Priya Patel, who holds an accepted row at each
 *   company so a single login walks the client switcher.
 *
 * Two smaller agencies sit beside it because two specs need states Apex cannot
 * show. Harbor Lane has a subscription in `past_due` since an hour before the
 * seed ran, so the grace window banner is one seed away and the lockout a week
 * after (spec 0008). Anchor Ridge is simply `canceled`, so it reads as
 * `locked` at once. Priya holds an accepted row at each, with Fernwood Clinic
 * and Cinder Media, so the switcher and the locked agency's unavailable page
 * can be walked for real (spec 0014, AC-11, AC-16). The name overlap between
 * the Harbor Lane agency and Apex's client Harbor Lane Capital is chance.
 *
 * `E2E_CLERK_CONTACT_USER_ID`, when set, is written as Priya's `clerk_user_id`
 * so every one of her rows binds to a real Clerk development account the
 * browser suite can sign in as (spec 0014, AC-16); unset, she keeps a fixed
 * seed id.
 *
 * Binding: with `SEED_CLERK_ORG_ID` set to a real Clerk organization, Apex is
 * built inside that organization so you can sign in and see it. The
 * organization keeps its own row, admin, memberships and subscription; only its
 * name and profile change, and its real admin owns the seeded invoices and
 * files. Its existing clients, projects, contacts, files and invoices are
 * written to `.seed-backups/<timestamp>.json` and then replaced. Every refusal
 * (no such organization, no admin) happens before anything is written.
 *
 * The wipe: before writing, every row the seed owns is deleted, in dependency
 * order, in the same transaction as the writes, so a failure leaves the
 * database exactly as it was. "The seed owns" means the fixed id namespace
 * below: organizations and users whose id starts with it, and every tenant
 * row under those organizations. A real agency, created through Clerk, has an
 * ordinary generated id and is never touched.
 *
 * Every id is a hardcoded constant, and every row is then written with "insert,
 * or update on conflict", so a second run replaces rather than duplicates.
 * Timestamps are relative to the run, so a second run moves them forward and
 * keeps the story the same age.
 *
 * The guard: this writes to `DIRECT_URL` only when its host is `localhost` or
 * the host named in `SEED_ALLOW_HOST`. Anything else exits non zero before a
 * connection is opened, so a production connection string in the wrong
 * terminal changes nothing.
 *
 * Money goes through `src/lib/money.ts`, so the seeded totals satisfy the
 * CHECK constraints the same way real writes will.
 */
import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  like,
  not,
  or,
  sql,
} from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import { env } from "../src/lib/env";
import { loadEnvFiles } from "../src/lib/load-env-files";
import { isStorageConfigured, objectStorage } from "../src/storage";
import {
  buildDataset,
  SEED_ID_PREFIX,
  SEEDED_PLACEMENT,
  type Placement,
  type SeedObject,
} from "./seed-dataset";

loadEnvFiles();

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export type HostCheck =
  | { readonly ok: true; readonly host: string }
  | { readonly ok: false; readonly problem: string };

/** May the seed write to this connection string? Pure, so it is testable. */
export function checkSeedHost(
  directUrl: string,
  allowHost: string | undefined,
): HostCheck {
  const host = (() => {
    try {
      return new URL(directUrl).hostname;
    } catch {
      return undefined;
    }
  })();

  if (host === undefined || host === "") {
    return { ok: false, problem: "DIRECT_URL is not a valid connection URL." };
  }

  if (host === "localhost" || host === allowHost) {
    return { ok: true, host };
  }

  return {
    ok: false,
    problem:
      `Refusing to seed ${host}. The seed writes only to localhost, or to the host ` +
      `named in SEED_ALLOW_HOST${allowHost ? ` (currently ${allowHost})` : " (not set)"}.`,
  };
}

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof drizzle<typeof schema>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type InsertKey<T extends PgTable> = Extract<keyof T["$inferInsert"], string>;

/** Is `key` one of this table's columns? A type predicate, so no cast is needed. */
function isInsertKey<T extends PgTable>(
  table: T,
  key: string,
): key is InsertKey<T> {
  return key in getTableColumns(table);
}

/**
 * The `set` clause for "update on conflict": every column except `id`, each
 * set to the incoming value (`excluded.<column>`), so a changed seed overwrites
 * what an earlier run wrote.
 */
function excludedColumns<T extends PgTable>(table: T): PgUpdateSetSource<T> {
  const columns = getTableColumns(table);

  return Object.keys(columns)
    .filter((key) => isInsertKey(table, key))
    .filter((key) => key !== "id")
    .reduce<PgUpdateSetSource<T>>(
      (set, key) => ({
        ...set,
        [key]: sql`excluded.${sql.identifier(columns[key].name)}`,
      }),
      {},
    );
}

/** Insert every row, or update it in place when its id already exists. */
async function upsertAll<
  T extends PgTable & { id: PgTable["_"]["columns"][string] },
>(tx: Tx, table: T, rows: readonly T["$inferInsert"][]): Promise<number> {
  if (rows.length === 0) return 0;

  await tx
    .insert(table)
    .values([...rows])
    .onConflictDoUpdate({ target: table.id, set: excludedColumns(table) });

  return rows.length;
}

/**
 * Delete every row the seed owns, children before parents so no RESTRICT
 * foreign key objects: events and line items, then invoices, deliverables,
 * projects, contacts, clients, the subscription and memberships, then the
 * organizations, then the users.
 *
 * "Owns" is the seed's id namespace and the organizations inside it. Bound to
 * a real organization (`boundOrgId`), it also owns that organization's
 * business data, whatever its ids: clients, projects, contacts, files and
 * invoices. Never the organization, its memberships or its subscription,
 * which are the real ones, unless their ids are the seed's own.
 */
async function wipeSeedData(
  tx: Tx,
  boundOrgId: string | undefined,
): Promise<Readonly<Record<string, number>>> {
  const prefix = `${SEED_ID_PREFIX}%`;

  const seedOrgIds = tx
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(like(sql`${schema.organizations.id}::text`, prefix));

  const inNamespace = (id: PgColumn) => like(sql`${id}::text`, prefix);

  /** Seed organizations and namespace ids only: what identity rows use. */
  const seedOwned = (columns: {
    readonly id: PgColumn;
    readonly orgId: PgColumn;
  }) => or(inArray(columns.orgId, seedOrgIds), inNamespace(columns.id));

  /** The same, plus every row of the bound organization: business data only. */
  const businessOwned = (columns: {
    readonly id: PgColumn;
    readonly orgId: PgColumn;
  }) =>
    or(
      seedOwned(columns),
      boundOrgId === undefined ? undefined : eq(columns.orgId, boundOrgId),
    );

  const removed = async (rows: PromiseLike<readonly unknown[]>) =>
    (await rows).length;

  return {
    invoice_events: await removed(
      tx
        .delete(schema.invoiceEvents)
        .where(businessOwned(schema.invoiceEvents))
        .returning({ id: schema.invoiceEvents.id }),
    ),
    invoice_line_items: await removed(
      tx
        .delete(schema.invoiceLineItems)
        .where(businessOwned(schema.invoiceLineItems))
        .returning({ id: schema.invoiceLineItems.id }),
    ),
    invoices: await removed(
      tx
        .delete(schema.invoices)
        .where(businessOwned(schema.invoices))
        .returning({ id: schema.invoices.id }),
    ),
    deliverables: await removed(
      tx
        .delete(schema.deliverables)
        .where(businessOwned(schema.deliverables))
        .returning({ id: schema.deliverables.id }),
    ),
    projects: await removed(
      tx
        .delete(schema.projects)
        .where(businessOwned(schema.projects))
        .returning({ id: schema.projects.id }),
    ),
    client_contacts: await removed(
      tx
        .delete(schema.clientContacts)
        .where(businessOwned(schema.clientContacts))
        .returning({ id: schema.clientContacts.id }),
    ),
    clients: await removed(
      tx
        .delete(schema.clients)
        .where(businessOwned(schema.clients))
        .returning({ id: schema.clients.id }),
    ),
    subscriptions: await removed(
      tx
        .delete(schema.subscriptions)
        .where(seedOwned(schema.subscriptions))
        .returning({ id: schema.subscriptions.id }),
    ),
    memberships: await removed(
      tx
        .delete(schema.memberships)
        .where(seedOwned(schema.memberships))
        .returning({ id: schema.memberships.id }),
    ),
    organizations: await removed(
      tx
        .delete(schema.organizations)
        .where(inNamespace(schema.organizations.id))
        .returning({ id: schema.organizations.id }),
    ),
    users: await removed(
      tx
        .delete(schema.users)
        .where(inNamespace(schema.users.id))
        .returning({ id: schema.users.id }),
    ),
  };
}

// ---------------------------------------------------------------------------
// Binding to a real organization
// ---------------------------------------------------------------------------

export type PlacementLookup =
  | { readonly ok: true; readonly placement: Placement }
  | { readonly ok: false; readonly problem: string };

/**
 * Work out where Apex goes for a `SEED_CLERK_ORG_ID`. Every refusal is a
 * value, and each happens before anything is written: an unknown or deleted
 * organization, one that is the seed's own, or one with no admin to own the
 * invoices. Unset, Apex is the seed's own organization.
 */
async function resolvePlacement(
  db: Db,
  clerkOrgId: string | undefined,
): Promise<PlacementLookup> {
  if (clerkOrgId === undefined) {
    return { ok: true, placement: SEEDED_PLACEMENT };
  }

  const [org] = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      deletedAt: schema.organizations.deletedAt,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.clerkOrgId, clerkOrgId))
    .limit(1);

  if (org === undefined || org.deletedAt !== null) {
    return {
      ok: false,
      problem: `SEED_CLERK_ORG_ID ${clerkOrgId} has no live local organization. Sign in to the app once as a member so its row exists, then seed again.`,
    };
  }

  if (org.id.startsWith(SEED_ID_PREFIX)) {
    return {
      ok: false,
      problem: `SEED_CLERK_ORG_ID ${clerkOrgId} is one of the seed's own organizations, not a real one.`,
    };
  }

  const [admin] = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.orgId, org.id),
        eq(schema.memberships.role, "admin"),
        not(
          like(sql`${schema.memberships.userId}::text`, `${SEED_ID_PREFIX}%`),
        ),
      ),
    )
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);

  if (admin === undefined) {
    return {
      ok: false,
      problem: `${org.name} has no admin in its local membership mirror to own the seeded invoices and files.`,
    };
  }

  const [subscription] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.orgId, org.id),
        not(like(sql`${schema.subscriptions.id}::text`, `${SEED_ID_PREFIX}%`)),
      ),
    )
    .limit(1);

  return {
    ok: true,
    placement: {
      orgId: org.id,
      ownerId: admin.userId,
      bound: true,
      needsSubscription: subscription === undefined,
    },
  };
}

/**
 * Write the bound organization's own business data to a JSON file before the
 * wipe removes it, and say where. Only rows that are not the seed's (a
 * previous run's rows are not worth keeping), and nothing is written when
 * there are none. Every column of every row is kept, dates as ISO strings, so
 * the file is enough to put the data back by hand.
 */
async function backupBusinessData(
  db: Db,
  orgId: string,
  now: Date,
): Promise<{ readonly path: string; readonly total: number } | undefined> {
  const notSeed = (id: PgColumn) =>
    not(like(sql`${id}::text`, `${SEED_ID_PREFIX}%`));

  const tables = {
    clients: await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.orgId, orgId), notSeed(schema.clients.id))),
    client_contacts: await db
      .select()
      .from(schema.clientContacts)
      .where(
        and(
          eq(schema.clientContacts.orgId, orgId),
          notSeed(schema.clientContacts.id),
        ),
      ),
    projects: await db
      .select()
      .from(schema.projects)
      .where(
        and(eq(schema.projects.orgId, orgId), notSeed(schema.projects.id)),
      ),
    deliverables: await db
      .select()
      .from(schema.deliverables)
      .where(
        and(
          eq(schema.deliverables.orgId, orgId),
          notSeed(schema.deliverables.id),
        ),
      ),
    invoices: await db
      .select()
      .from(schema.invoices)
      .where(
        and(eq(schema.invoices.orgId, orgId), notSeed(schema.invoices.id)),
      ),
    invoice_line_items: await db
      .select()
      .from(schema.invoiceLineItems)
      .where(
        and(
          eq(schema.invoiceLineItems.orgId, orgId),
          notSeed(schema.invoiceLineItems.id),
        ),
      ),
    invoice_events: await db
      .select()
      .from(schema.invoiceEvents)
      .where(
        and(
          eq(schema.invoiceEvents.orgId, orgId),
          notSeed(schema.invoiceEvents.id),
        ),
      ),
  };

  const total = Object.values(tables).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );

  if (total === 0) {
    return undefined;
  }

  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId));

  const directory = ".seed-backups";
  const path = `${directory}/${now.toISOString().replace(/[:.]/g, "-")}.json`;

  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ takenAt: now.toISOString(), organization, tables }, undefined, 2)}\n`,
  );

  return { path, total };
}

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

export type UploadResult =
  { readonly ok: true } | { readonly ok: false; readonly problem: string };

/**
 * Put one file in the bucket through a signed PUT, the same way the app's own
 * upload does. An expected failure comes back as a value: the rows are already
 * committed, and a missing object only means that file's download lands on the
 * "This file is missing" page.
 */
async function uploadObject(
  storage: NonNullable<ReturnType<typeof objectStorage>>,
  object: SeedObject,
): Promise<UploadResult> {
  try {
    const url = await storage.presignPut({
      key: object.key,
      contentType: object.contentType,
      contentLength: object.bytes.length,
      expiresInSeconds: 300,
    });

    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": object.contentType },
      body: Buffer.from(object.bytes),
    });

    return response.ok
      ? { ok: true }
      : {
          ok: false,
          problem: `${object.name}: R2 answered ${response.status}`,
        };
  } catch (error) {
    return {
      ok: false,
      problem: `${object.name}: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

async function uploadObjects(
  objects: readonly SeedObject[],
): Promise<
  | { readonly skipped: true }
  | { readonly skipped: false; readonly results: readonly UploadResult[] }
> {
  const storage = isStorageConfigured() ? objectStorage() : undefined;

  if (storage === undefined) {
    return { skipped: true };
  }

  const results = await Promise.all(
    objects.map((object) => uploadObject(storage, object)),
  );

  return { skipped: false, results };
}

/**
 * Delete the objects earlier seed runs left in the bucket. The row goes first
 * only inside the wipe's transaction; here, after it, the objects are best
 * effort: a failure is reported and never fails the seed. Only keys of rows in
 * the seed's own namespace, and only ones the new dataset does not reuse, so a
 * file the bound organization owned for real is never touched.
 */
async function removeStaleObjects(
  keys: readonly string[],
): Promise<{ readonly removed: number; readonly failed: number } | undefined> {
  const storage = isStorageConfigured() ? objectStorage() : undefined;

  if (storage === undefined || keys.length === 0) {
    return undefined;
  }

  const results = await Promise.all(
    keys.map((key) =>
      storage.delete(key).then(
        () => true,
        () => false,
      ),
    ),
  );

  return {
    removed: results.filter((ok) => ok).length,
    failed: results.filter((ok) => !ok).length,
  };
}

async function main(): Promise<number> {
  const {
    DIRECT_URL,
    SEED_ALLOW_HOST,
    SEED_CLERK_ORG_ID,
    E2E_CLERK_CONTACT_USER_ID,
  } = env();

  const allowed = checkSeedHost(DIRECT_URL, SEED_ALLOW_HOST);
  if (!allowed.ok) {
    console.error(allowed.problem);
    return 1;
  }

  const now = new Date();
  const client = postgres(DIRECT_URL, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    // Everything that can refuse happens here, before a single write.
    const target = await resolvePlacement(db, SEED_CLERK_ORG_ID);
    if (!target.ok) {
      console.error(target.problem);
      return 1;
    }

    const { placement } = target;
    const data = buildDataset({
      now,
      priyaClerkUserId: E2E_CLERK_CONTACT_USER_ID ?? "user_seed_priya",
      placement,
    });

    const backup = placement.bound
      ? await backupBusinessData(db, placement.orgId, now)
      : undefined;

    const oldObjects = await db
      .select({ key: schema.deliverables.r2Key })
      .from(schema.deliverables)
      .where(like(sql`${schema.deliverables.id}::text`, `${SEED_ID_PREFIX}%`));

    const { wiped, counts } = await db.transaction(async (tx) => {
      const wiped = await wipeSeedData(
        tx,
        placement.bound ? placement.orgId : undefined,
      );

      // Bound, the organization is the real one: only its profile changes.
      if (placement.bound) {
        await tx
          .update(schema.organizations)
          .set(data.apexProfile)
          .where(eq(schema.organizations.id, placement.orgId));
      }

      const counts = {
        organizations: await upsertAll(
          tx,
          schema.organizations,
          data.organizations,
        ),
        users: await upsertAll(tx, schema.users, data.users),
        memberships: await upsertAll(tx, schema.memberships, data.memberships),
        subscriptions: await upsertAll(
          tx,
          schema.subscriptions,
          data.subscriptions,
        ),
        clients: await upsertAll(tx, schema.clients, data.clients),
        client_contacts: await upsertAll(
          tx,
          schema.clientContacts,
          data.clientContacts,
        ),
        projects: await upsertAll(tx, schema.projects, data.projects),
        deliverables: await upsertAll(
          tx,
          schema.deliverables,
          data.deliverables,
        ),
        invoices: await upsertAll(tx, schema.invoices, data.invoices),
        invoice_line_items: await upsertAll(
          tx,
          schema.invoiceLineItems,
          data.invoiceLineItems,
        ),
        invoice_events: await upsertAll(
          tx,
          schema.invoiceEvents,
          data.invoiceEvents,
        ),
      };

      return { wiped, counts };
    });

    const removedTotal = Object.values(wiped).reduce(
      (total, count) => total + count,
      0,
    );

    console.log(`Seeded ${allowed.host} (replaced ${removedTotal} old rows):`);
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(24)} ${count}`);
    }

    console.log(
      placement.bound
        ? `Apex Interactive Studio is built inside the real organization ${SEED_CLERK_ORG_ID}.`
        : "Apex Interactive Studio is the seed's own agency: nobody can sign in to it. " +
            "Set SEED_CLERK_ORG_ID to build it inside a real organization.",
    );

    if (backup !== undefined) {
      console.log(
        `Backup: ${backup.total} rows of the organization's own data written to ${backup.path}.`,
      );
    }

    const newKeys = new Set(data.deliverables.map((row) => row.r2Key));
    const stale = await removeStaleObjects(
      oldObjects.map((row) => row.key).filter((key) => !newKeys.has(key)),
    );
    if (stale !== undefined) {
      console.log(
        `Files: removed ${stale.removed} old seeded objects from R2` +
          (stale.failed > 0 ? `, ${stale.failed} could not be removed.` : "."),
      );
    }

    const uploaded = await uploadObjects(data.objects);

    if (uploaded.skipped) {
      console.log(
        "Files: R2 is not configured, so no objects were uploaded. " +
          "Downloads show the missing file page.",
      );
    } else {
      const failed = uploaded.results.flatMap((result) =>
        result.ok ? [] : [result.problem],
      );
      console.log(
        `Files: ${uploaded.results.length - failed.length} of ${uploaded.results.length} uploaded to R2.`,
      );
      for (const problem of failed) {
        console.warn(`  not uploaded, ${problem}`);
      }
    }

    return 0;
  } finally {
    await client.end();
  }
}

// Only run when executed directly, so the guard can be imported by a test.
if (process.argv[1]?.endsWith("db-seed.ts")) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error("Seeding failed; the transaction was rolled back.");
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
