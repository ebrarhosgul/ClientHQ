/**
 * @vitest-environment node
 *
 * covers: spec 0002 AC-2 (every tenant scoped table carries `org_id not null`
 * and an index leading with it), AC-3 (the money, quantity and currency column
 * types), AC-6 (every foreign key's ON DELETE action), AC-8 (the unique and
 * CHECK constraints)
 *
 * `scripts/db-schema-assert.ts` checks the same contract against a real
 * PostgreSQL catalogue. This checks it against the Drizzle definitions, which
 * is a different job in two ways worth having:
 *
 *   - it needs no database, so a schema change that breaks the spec fails in
 *     the fast unit job rather than only in the container job
 *   - it reads the tables out of the schema modules instead of a hand written
 *     list, so a table added later is swept in automatically. The script cannot
 *     do that: its list is the spec, transcribed
 *
 * It sits here rather than beside the tables in `src/db/schema/`, which is
 * where the project's convention would put it, because `drizzle.config.ts`
 * points `schema` at that whole directory. drizzle-kit loads every `.ts` file
 * it finds there as schema, and a file importing Vitest breaks
 * `pnpm db:migrate:check` and the CI gate behind it.
 *
 * The status value sets are the sharpest case here. Each one is written three
 * times, as a TypeScript union, as the `enum` on the Drizzle column, and again
 * inside a CHECK constraint. Nothing else compares the three, so a value added
 * to the union alone would typecheck, migrate and then be rejected at runtime.
 */
import { is } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as clientsSchema from "./schema/clients";
import * as cronSchema from "./schema/cron";
import * as identitySchema from "./schema/identity";
import * as invoicesSchema from "./schema/invoices";
import * as projectsSchema from "./schema/projects";
import * as rateLimitSchema from "./schema/rate-limit";
import * as webhooksSchema from "./schema/webhooks";

const { MEMBERSHIP_ROLES, organizations, users } = identitySchema;
const { clientContacts } = clientsSchema;
const { DELIVERABLE_STATUSES, PROJECT_STATUSES } = projectsSchema;
const { INVOICE_STATUSES, invoices } = invoicesSchema;
const { WEBHOOK_SOURCES, processedWebhookEvents } = webhooksSchema;

/** Every table the schema defines, found rather than listed. */
const TABLES: readonly PgTable[] = [
  identitySchema,
  clientsSchema,
  projectsSchema,
  invoicesSchema,
  webhooksSchema,
  cronSchema,
  rateLimitSchema,
]
  .flatMap((module) => Object.values(module))
  .filter((value): value is PgTable => is(value, PgTable));

const configOf = (table: PgTable) => getTableConfig(table);
const nameOf = (table: PgTable): string => configOf(table).name;

const byName = (name: string): PgTable => {
  const table = TABLES.find((candidate) => nameOf(candidate) === name);
  if (table === undefined) throw new Error(`No table named ${name}`);
  return table;
};

const columnOf = (table: string, column: string): PgColumn | undefined =>
  configOf(byName(table)).columns.find(
    (candidate) => candidate.name === column,
  );

/** Anything with a `name`: a column in an index or unique constraint. */
const hasName = (value: unknown): value is { readonly name: string } =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string";

const columnNames = (columns: readonly unknown[]): readonly string[] =>
  columns.map((column) => (hasName(column) ? column.name : "<expression>"));

const dialect = new PgDialect();

/** The literals a `column in ('a', 'b')` CHECK lists. */
const checkLiterals = (
  table: string,
  constraint: string,
): readonly string[] => {
  const check = configOf(byName(table)).checks.find(
    (candidate) => candidate.name === constraint,
  );
  if (check === undefined) throw new Error(`No CHECK named ${constraint}`);

  const sql = dialect.sqlToQuery(check.value).sql;
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
};

/**
 * `organizations` is the tenant root, and spec 0002 exempts `users` (one person
 * may serve several agencies) and `processed_webhook_events` (not tenant
 * data); spec 0017 adds `cron_runs` for the same reason as the last one, and
 * spec 0018 adds `rate_limit_windows`, whose `create_agency` subject is a
 * person with no agency yet.
 */
const NOT_TENANT_SCOPED: readonly string[] = [
  "organizations",
  "users",
  "processed_webhook_events",
  "cron_runs",
  "rate_limit_windows",
];

const TENANT_SCOPED = TABLES.filter(
  (table) => !NOT_TENANT_SCOPED.includes(nameOf(table)),
);

describe("the schema defines exactly the fifteen tables the specs name", () => {
  it("has all fifteen (spec 0002's eleven, plus spec 0012's invoice_events, spec 0017's cron_runs, spec 0018's rate_limit_windows, and invitation_sends from the security audit fix for spec 0009's rate limit bypass), and no sixteenth nobody wrote down", () => {
    expect(TABLES.map(nameOf).sort()).toEqual([
      "client_contacts",
      "clients",
      "cron_runs",
      "deliverables",
      "invitation_sends",
      "invoice_events",
      "invoice_line_items",
      "invoices",
      "memberships",
      "organizations",
      "processed_webhook_events",
      "projects",
      "rate_limit_windows",
      "subscriptions",
      "users",
    ]);
  });

  it("gives every table but rate_limit_windows a single `id uuid` primary key, filled by newId()", () => {
    // rate_limit_windows carries no id at all: its primary key is the
    // composite (subject, action, window_start) the atomic upsert conflicts
    // on (spec 0018, AC-9).
    for (const table of TABLES) {
      if (nameOf(table) === "rate_limit_windows") continue;

      const keys = configOf(table)
        .columns.filter((column) => column.primary)
        .map((column) => `${column.name} ${column.getSQLType()}`);
      expect(keys, nameOf(table)).toEqual(["id uuid"]);
    }
  });

  it("gives every table but the webhook ledger, the append only events, the cron run row, the rate limit windows and the invitation send ledger created_at and updated_at, both timestamptz not null", () => {
    for (const table of TABLES) {
      if (nameOf(table) === "processed_webhook_events") continue;
      // rate_limit_windows carries `updated_at` alone, for debugging an
      // abuse report only; it has no `created_at` (spec 0018, data model).
      if (nameOf(table) === "rate_limit_windows") continue;
      // Spec 0012: rows are never updated, so there is nothing to stamp.
      if (nameOf(table) === "invoice_events") continue;
      // Spec 0017: a run has started_at/finished_at instead, since a run in
      // progress is exactly a row that has not finished, not a row updated.
      if (nameOf(table) === "cron_runs") continue;
      // Append only, like invoice_events: `sent_at` is its one timestamp,
      // and nothing here ever updates a row (security audit finding #4).
      if (nameOf(table) === "invitation_sends") continue;

      for (const name of ["created_at", "updated_at"]) {
        const column = configOf(table).columns.find(
          (candidate) => candidate.name === name,
        );
        expect(column?.getSQLType(), `${nameOf(table)}.${name}`).toBe(
          "timestamp with time zone",
        );
        expect(column?.notNull, `${nameOf(table)}.${name}`).toBe(true);
      }
    }
  });
});

/**
 * AC-2. This is the one precondition a future row level security policy needs,
 * and the sweep is over found tables so a table added later cannot skip it.
 */
describe("AC-2: every tenant scoped table is scoped by org_id", () => {
  it("covers the ten tables the specs scope, and only those", () => {
    expect(TENANT_SCOPED.map(nameOf).sort()).toEqual([
      "client_contacts",
      "clients",
      "deliverables",
      "invitation_sends",
      "invoice_events",
      "invoice_line_items",
      "invoices",
      "memberships",
      "projects",
      "subscriptions",
    ]);
  });

  it("declares org_id as uuid not null on each of them, with no exceptions", () => {
    for (const table of TENANT_SCOPED) {
      const orgId = configOf(table).columns.find(
        (column) => column.name === "org_id",
      );
      expect(orgId?.getSQLType(), nameOf(table)).toBe("uuid");
      expect(orgId?.notNull, nameOf(table)).toBe(true);
    }
  });

  it("gives each of them an index or unique constraint leading with org_id, so a tenant scoped read can use it", () => {
    for (const table of TENANT_SCOPED) {
      const config = configOf(table);
      const leading = [
        ...config.indexes.map((index) => columnNames(index.config.columns)),
        ...config.uniqueConstraints.map((unique) =>
          columnNames(unique.columns),
        ),
        ...config.columns
          .filter((column) => column.isUnique)
          .map((column) => [column.name]),
      ];
      expect(
        leading.some((columns) => columns[0] === "org_id"),
        `${nameOf(table)} has no index leading with org_id, only ${JSON.stringify(leading)}`,
      ).toBe(true);
    }
  });

  it("points every org_id at organizations.id", () => {
    for (const table of TENANT_SCOPED) {
      const foreignKey = configOf(table).foreignKeys.find(
        (candidate) =>
          columnNames(candidate.reference().columns)[0] === "org_id",
      );
      const reference = foreignKey?.reference();
      expect(
        reference === undefined ? undefined : nameOf(reference.foreignTable),
        nameOf(table),
      ).toBe("organizations");
      expect(
        reference === undefined
          ? undefined
          : columnNames(reference.foreignColumns),
        nameOf(table),
      ).toEqual(["id"]);
    }
  });
});

/**
 * AC-6. Whether a delete cascades or is refused is the entire mechanism behind
 * "financial and work history cannot be lost". A wrong action here migrates
 * cleanly and destroys data later, so each one is pinned by name.
 */
describe("AC-6: every foreign key deletes the way the spec says", () => {
  const FOREIGN_KEYS: readonly [string, string, string, string][] = [
    ["memberships", "org_id", "organizations", "cascade"],
    ["memberships", "user_id", "users", "cascade"],
    ["subscriptions", "org_id", "organizations", "cascade"],
    ["clients", "org_id", "organizations", "cascade"],
    ["client_contacts", "org_id", "organizations", "cascade"],
    ["client_contacts", "client_id", "clients", "cascade"],
    ["client_contacts", "user_id", "users", "set null"],
    // Spec 0009: the inviter, cleared if that staff member is deleted.
    ["client_contacts", "invited_by_user_id", "users", "set null"],
    ["projects", "org_id", "organizations", "cascade"],
    ["projects", "client_id", "clients", "restrict"],
    ["deliverables", "org_id", "organizations", "restrict"],
    ["deliverables", "project_id", "projects", "restrict"],
    ["deliverables", "uploaded_by_user_id", "users", "restrict"],
    ["invoices", "org_id", "organizations", "restrict"],
    ["invoices", "client_id", "clients", "restrict"],
    ["invoice_line_items", "org_id", "organizations", "restrict"],
    ["invoice_line_items", "invoice_id", "invoices", "cascade"],
    // Spec 0012: the history goes with its invoice and its organization; the
    // actor is cleared if that staff member is deleted.
    ["invoice_events", "org_id", "organizations", "cascade"],
    ["invoice_events", "invoice_id", "invoices", "cascade"],
    ["invoice_events", "actor_user_id", "users", "set null"],
    // Security audit finding #4: an append only ledger, so it cascades with
    // its organization like every other tenant scoped table.
    ["invitation_sends", "org_id", "organizations", "cascade"],
  ];

  it.each(FOREIGN_KEYS)(
    "%s.%s references %s on delete %s",
    (table, column, references, onDelete) => {
      const foreignKey = configOf(byName(table)).foreignKeys.find(
        (candidate) => columnNames(candidate.reference().columns)[0] === column,
      );
      expect(foreignKey, `${table}.${column} has no foreign key`).toBeDefined();

      const reference = foreignKey?.reference();
      expect(
        reference === undefined ? undefined : nameOf(reference.foreignTable),
      ).toBe(references);
      expect(foreignKey?.onDelete).toBe(onDelete);
    },
  );

  it("declares a foreign key for every table it names, and none it does not", () => {
    const declared = TABLES.flatMap((table) =>
      configOf(table).foreignKeys.map(
        (foreignKey) =>
          `${nameOf(table)}.${columnNames(foreignKey.reference().columns).join(",")}`,
      ),
    ).sort();
    const expected = FOREIGN_KEYS.map(
      ([table, column]) => `${table}.${column}`,
    ).sort();
    expect(declared).toEqual(expected);
  });
});

/**
 * AC-8. Each of these is what a key invariant rests on: numbering (AC-4),
 * one contact per email per client (AC-11), webhook idempotency, one
 * subscription per agency.
 */
describe("AC-8: the unique constraints the invariants rest on exist", () => {
  const UNIQUES: readonly [string, readonly string[]][] = [
    ["organizations", ["clerk_org_id"]],
    ["organizations", ["slug"]],
    ["users", ["clerk_user_id"]],
    ["memberships", ["org_id", "user_id"]],
    ["subscriptions", ["org_id"]],
    ["subscriptions", ["stripe_customer_id"]],
    ["subscriptions", ["stripe_subscription_id"]],
    ["client_contacts", ["client_id", "email"]],
    ["deliverables", ["r2_key"]],
    ["invoices", ["org_id", "number"]],
    ["invoice_line_items", ["invoice_id", "position"]],
    ["processed_webhook_events", ["source", "event_id"]],
  ];

  it.each(UNIQUES)("%s is unique on %s", (table, columns) => {
    const config = configOf(byName(table));
    const all = [
      ...config.uniqueConstraints.map((unique) => columnNames(unique.columns)),
      ...config.columns
        .filter((column) => column.isUnique)
        .map((column) => [column.name]),
    ];
    expect(all).toContainEqual([...columns]);
  });

  it("leaves client_contacts.user_id non unique, so one person can be a contact of several clients (AC-11)", () => {
    expect(columnOf("client_contacts", "user_id")?.isUnique).toBe(false);
  });

  it("leaves users.email non unique, so a stale mirror row and a scrub placeholder cannot collide", () => {
    expect(columnOf("users", "email")?.isUnique).toBe(false);
  });
});

/**
 * AC-8, and AC-5's mechanism. The CHECK expressions themselves are exercised
 * against a real PostgreSQL by `/check verify`; what is pinned here is that
 * each one is still declared.
 */
describe("AC-8: the CHECK constraints exist, by name", () => {
  const CHECKS: readonly [string, string][] = [
    ["users", "users_email_lowercase_check"],
    ["memberships", "memberships_role_check"],
    ["client_contacts", "client_contacts_email_lowercase_check"],
    ["clients", "clients_company_email_lowercase_check"],
    ["projects", "projects_status_check"],
    ["deliverables", "deliverables_status_check"],
    ["invoices", "invoices_status_check"],
    ["invoices", "invoices_currency_check"],
    ["invoices", "invoices_money_non_negative_check"],
    ["invoices", "invoices_tax_rate_bp_check"],
    ["invoices", "invoices_total_check"],
    ["invoices", "invoices_tax_check"],
    ["invoices", "invoices_paid_at_check"],
    ["invoice_line_items", "invoice_line_items_money_non_negative_check"],
    ["invoice_line_items", "invoice_line_items_quantity_positive_check"],
    ["invoice_line_items", "invoice_line_items_amount_check"],
    ["invoice_line_items", "invoice_line_items_position_check"],
    ["invoice_events", "invoice_events_kind_check"],
    ["invoice_events", "invoice_events_from_status_check"],
    ["invoice_events", "invoice_events_to_status_check"],
    ["invoice_events", "invoice_events_statuses_by_kind_check"],
    ["processed_webhook_events", "processed_webhook_events_source_check"],
  ];

  it.each(CHECKS)("%s has %s", (table, constraint) => {
    expect(configOf(byName(table)).checks.map((check) => check.name)).toContain(
      constraint,
    );
  });

  it("casts the subtotal to numeric before the tax multiply, so a large invoice cannot overflow int4 inside the CHECK", () => {
    const check = configOf(invoices).checks.find(
      (candidate) => candidate.name === "invoices_tax_check",
    );
    expect(check).toBeDefined();
    expect(
      check === undefined ? "" : dialect.sqlToQuery(check.value).sql,
    ).toContain('"subtotal_cents"::numeric');
  });
});

/**
 * Spec 0006, AC-1: only `name` is required on a client, so every other field
 * spec 0006 adds has to be nullable, unlike `client_contacts.email`, which
 * carries no such allowance.
 */
describe("spec 0006: a client's fields are all optional but the name", () => {
  it("requires clients.name", () => {
    expect(columnOf("clients", "name")?.notNull).toBe(true);
  });

  it.each([
    "company_email",
    "phone",
    "industry",
    "notes",
    "billing_address_line1",
    "billing_address_line2",
    "billing_city",
    "billing_region",
    "billing_postal_code",
    "billing_country",
  ])("leaves clients.%s nullable", (column) => {
    expect(columnOf("clients", column)?.notNull).toBe(false);
  });

  it("leaves company_email nullable, unlike client_contacts.email (a client can have none at all)", () => {
    expect(columnOf("clients", "company_email")?.notNull).toBe(false);
    expect(columnOf("client_contacts", "email")?.notNull).toBe(true);
  });
});

/**
 * The three copies of each value set have to agree: the TypeScript union, the
 * Drizzle column `enum`, and the CHECK constraint. Nothing else compares them.
 */
describe("the status value sets agree in all three places they are written", () => {
  const ENUMS: readonly [string, string, string, readonly string[]][] = [
    ["memberships", "role", "memberships_role_check", MEMBERSHIP_ROLES],
    ["projects", "status", "projects_status_check", PROJECT_STATUSES],
    [
      "deliverables",
      "status",
      "deliverables_status_check",
      DELIVERABLE_STATUSES,
    ],
    ["invoices", "status", "invoices_status_check", INVOICE_STATUSES],
    [
      "processed_webhook_events",
      "source",
      "processed_webhook_events_source_check",
      WEBHOOK_SOURCES,
    ],
  ];

  it.each(ENUMS)(
    "%s.%s: the CHECK lists exactly the TypeScript values",
    (table, column, constraint, values) => {
      expect(checkLiterals(table, constraint)).toEqual([...values]);
    },
  );

  it.each(ENUMS)(
    "%s.%s: the Drizzle column enum lists exactly the TypeScript values",
    (table, column, _constraint, values) => {
      expect(columnOf(table, column)?.enumValues).toEqual([...values]);
    },
  );

  it("keeps the invoice statuses the five the rest of the app switches over", () => {
    expect(INVOICE_STATUSES).toEqual([
      "draft",
      "sent",
      "paid",
      "overdue",
      "void",
    ]);
  });
});

/**
 * AC-3. Money is whole cents in `integer`, quantity is `numeric(12,3)` and
 * currency is `character(3)`. A `double precision` slipping in anywhere here is
 * the failure this whole design exists to prevent.
 */
describe("AC-3: the money, quantity and currency columns have the exact types", () => {
  const SHAPES: readonly [string, string, string, boolean][] = [
    ["organizations", "default_currency", "char(3)", true],
    ["organizations", "next_invoice_number", "integer", true],
    ["invoices", "currency", "char(3)", true],
    ["invoices", "subtotal_cents", "integer", true],
    ["invoices", "tax_rate_bp", "integer", true],
    ["invoices", "tax_cents", "integer", true],
    ["invoices", "total_cents", "integer", true],
    ["invoices", "number", "integer", false],
    ["invoices", "issue_date", "date", false],
    ["invoices", "due_date", "date", false],
    ["invoice_line_items", "quantity", "numeric(12, 3)", true],
    ["invoice_line_items", "unit_amount_cents", "integer", true],
    ["invoice_line_items", "amount_cents", "integer", true],
    ["invoice_line_items", "position", "integer", true],
    ["deliverables", "size_bytes", "bigint", true],
    ["projects", "due_date", "date", false],
  ];

  it.each(SHAPES)("%s.%s is %s", (table, column, type, notNull) => {
    const found = columnOf(table, column);
    expect(found?.getSQLType()).toBe(type);
    expect(found?.notNull).toBe(notNull);
  });

  it("reads quantity back as a string, so a float can never stand in for it", () => {
    const quantity = columnOf("invoice_line_items", "quantity");
    expect(quantity?.mapFromDriverValue("2.500")).toBe("2.500");
    expect(typeof quantity?.mapFromDriverValue("2.500")).toBe("string");
  });

  it("keeps a calendar day a string, so no timezone can shift the day (invoices.issue_date)", () => {
    expect(
      columnOf("invoices", "issue_date")?.mapFromDriverValue("2026-09-06"),
    ).toBe("2026-09-06");
  });
});

describe("the soft delete columns exist, so nothing is erased by a delete", () => {
  it.each([
    ["organizations", "deleted_at"],
    ["users", "deleted_at"],
    ["clients", "archived_at"],
    ["projects", "archived_at"],
  ])("%s has a nullable %s", (table, column) => {
    const found = columnOf(table, column);
    expect(found?.getSQLType()).toBe("timestamp with time zone");
    expect(found?.notNull).toBe(false);
  });

  it("stores no webhook payload, because both providers keep the original and it carries personal data", () => {
    const columns = configOf(processedWebhookEvents).columns.map(
      (column) => column.name,
    );
    expect(columns).toEqual([
      "id",
      "source",
      "event_id",
      "event_type",
      "processed_at",
    ]);
  });

  it("stores only the hash of an invite token, never the token", () => {
    const columns = configOf(clientContacts).columns.map(
      (column) => column.name,
    );
    expect(columns).toContain("invite_token_hash");
    expect(columns).not.toContain("invite_token");
  });
});

describe("the tables the spec exempts from tenant scoping have no org_id at all", () => {
  it.each([organizations, users, processedWebhookEvents])(
    "has no org_id column",
    (table) => {
      expect(
        configOf(table).columns.map((column) => column.name),
      ).not.toContain("org_id");
    },
  );

  it("keeps subscriptions one per agency, by making its org_id unique", () => {
    expect(columnOf("subscriptions", "org_id")?.isUnique).toBe(true);
  });

  it("allows an invoice number to be null while the invoice is a draft", () => {
    expect(columnOf("invoices", "number")?.notNull).toBe(false);
  });

  it("counts invoice numbers from a per organization counter that starts at 1", () => {
    expect(columnOf("organizations", "next_invoice_number")?.default).toBe(1);
  });

  it("starts an invoice as a draft in the agency's own currency", () => {
    expect(columnOf("invoices", "status")?.default).toBe("draft");
    expect(columnOf("organizations", "default_currency")?.default).toBe("USD");
  });

  it("hides a deliverable from the client until someone says otherwise, and starts it pending", () => {
    expect(columnOf("deliverables", "visible_to_client")?.default).toBe(false);
    expect(columnOf("deliverables", "status")?.default).toBe("pending");
  });
});

describe("the schema barrel re-exports every table, so db.query can reach them", () => {
  it("exports all fourteen", async () => {
    const barrel: Record<string, unknown> = await import("./schema/index");
    const exported = Object.values(barrel).filter((value): value is PgTable =>
      is(value, PgTable),
    );
    expect(exported.map(nameOf).sort()).toEqual(TABLES.map(nameOf).sort());
  });
});
