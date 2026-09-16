/**
 * Prove the applied schema is the one spec 0002 describes (plus the `notes`
 * column and `invoice_events` table spec 0012 adds), by reading the
 * PostgreSQL catalogue rather than by eye.
 *
 * CI runs this right after `pnpm db:migrate` against a throwaway container, and
 * you can run it against any database with `pnpm db:schema:assert`. It asserts:
 *
 *   - every one of the twelve tables exists
 *   - every tenant scoped table has `org_id uuid not null` and at least one
 *     index whose leading column is `org_id` (AC-2)
 *   - every unique constraint, CHECK constraint and plain index the spec names
 *     exists (AC-8)
 *   - every foreign key's ON DELETE action matches the spec, read from
 *     `pg_constraint.confdeltype` (AC-6, AC-8). The RESTRICT and CASCADE
 *     choices are the exact mechanism AC-6 rests on, and a wrong one would
 *     otherwise pass CI in silence
 *   - the money, quantity and currency columns have the types AC-3 requires
 *
 * The expectations below are data, copied from the spec's Data model section.
 * When the spec changes, change them here in the same pull request.
 *
 * Connects over `DIRECT_URL`. Reads only; writes nothing.
 */
import postgres from "postgres";

import { loadEnvFiles } from "../src/lib/load-env-files";

loadEnvFiles();

type OnDelete = "cascade" | "restrict" | "set null";

type ForeignKey = {
  readonly table: string;
  readonly column: string;
  readonly references: string;
  readonly onDelete: OnDelete;
};

type ColumnShape = {
  readonly table: string;
  readonly column: string;
  readonly type: string;
  readonly nullable?: boolean;
};

const TABLES: readonly string[] = [
  "organizations",
  "users",
  "memberships",
  "subscriptions",
  "clients",
  "client_contacts",
  "projects",
  "deliverables",
  "invoices",
  "invoice_line_items",
  "invoice_events",
  "processed_webhook_events",
];

/**
 * Everything except the tenant root (`organizations`) and the two tables spec
 * 0002 exempts (`users`, `processed_webhook_events`).
 */
const TENANT_SCOPED: readonly string[] = [
  "memberships",
  "subscriptions",
  "clients",
  "client_contacts",
  "projects",
  "deliverables",
  "invoices",
  "invoice_line_items",
  "invoice_events",
];

const UNIQUE_CONSTRAINTS: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  organizations: [["clerk_org_id"], ["slug"]],
  users: [["clerk_user_id"]],
  memberships: [["org_id", "user_id"]],
  subscriptions: [
    ["org_id"],
    ["stripe_customer_id"],
    ["stripe_subscription_id"],
  ],
  client_contacts: [["client_id", "email"]],
  deliverables: [["r2_key"]],
  invoices: [["org_id", "number"]],
  invoice_line_items: [["invoice_id", "position"]],
  processed_webhook_events: [["source", "event_id"]],
};

const CHECK_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {
  users: ["users_email_lowercase_check"],
  memberships: ["memberships_role_check"],
  client_contacts: ["client_contacts_email_lowercase_check"],
  projects: ["projects_status_check"],
  deliverables: ["deliverables_status_check"],
  invoices: [
    "invoices_status_check",
    "invoices_currency_check",
    "invoices_money_non_negative_check",
    "invoices_tax_rate_bp_check",
    "invoices_total_check",
    "invoices_tax_check",
    "invoices_paid_at_check",
  ],
  invoice_line_items: [
    "invoice_line_items_money_non_negative_check",
    "invoice_line_items_quantity_positive_check",
    "invoice_line_items_amount_check",
    "invoice_line_items_position_check",
  ],
  invoice_events: [
    "invoice_events_kind_check",
    "invoice_events_from_status_check",
    "invoice_events_to_status_check",
    "invoice_events_statuses_by_kind_check",
  ],
  processed_webhook_events: ["processed_webhook_events_source_check"],
};

/** Plain (non unique) indexes, by column list in order. */
const INDEXES: Readonly<Record<string, readonly (readonly string[])[]>> = {
  users: [["email"]],
  memberships: [["user_id"]],
  clients: [
    ["org_id", "archived_at"],
    ["org_id", "name"],
  ],
  client_contacts: [
    ["user_id"],
    ["org_id", "client_id"],
    ["invited_by_user_id"],
  ],
  projects: [
    ["org_id", "client_id"],
    ["org_id", "status"],
    ["org_id", "archived_at"],
  ],
  deliverables: [
    ["org_id", "project_id"],
    ["org_id", "status", "created_at"],
  ],
  invoices: [
    ["org_id", "client_id"],
    ["org_id", "status", "due_date"],
  ],
  invoice_line_items: [["org_id", "invoice_id"]],
  invoice_events: [["org_id", "invoice_id", "created_at"]],
  processed_webhook_events: [["processed_at"]],
};

const FOREIGN_KEYS: readonly ForeignKey[] = [
  {
    table: "memberships",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "memberships",
    column: "user_id",
    references: "users",
    onDelete: "cascade",
  },
  {
    table: "subscriptions",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "clients",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "client_contacts",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "client_contacts",
    column: "client_id",
    references: "clients",
    onDelete: "cascade",
  },
  {
    table: "client_contacts",
    column: "user_id",
    references: "users",
    onDelete: "set null",
  },
  {
    table: "client_contacts",
    column: "invited_by_user_id",
    references: "users",
    onDelete: "set null",
  },
  {
    table: "projects",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "projects",
    column: "client_id",
    references: "clients",
    onDelete: "restrict",
  },
  {
    table: "deliverables",
    column: "org_id",
    references: "organizations",
    onDelete: "restrict",
  },
  {
    table: "deliverables",
    column: "project_id",
    references: "projects",
    onDelete: "restrict",
  },
  {
    table: "deliverables",
    column: "uploaded_by_user_id",
    references: "users",
    onDelete: "restrict",
  },
  {
    table: "invoices",
    column: "org_id",
    references: "organizations",
    onDelete: "restrict",
  },
  {
    table: "invoices",
    column: "client_id",
    references: "clients",
    onDelete: "restrict",
  },
  {
    table: "invoice_line_items",
    column: "org_id",
    references: "organizations",
    onDelete: "restrict",
  },
  {
    table: "invoice_line_items",
    column: "invoice_id",
    references: "invoices",
    onDelete: "cascade",
  },
  {
    table: "invoice_events",
    column: "org_id",
    references: "organizations",
    onDelete: "cascade",
  },
  {
    table: "invoice_events",
    column: "invoice_id",
    references: "invoices",
    onDelete: "cascade",
  },
  {
    table: "invoice_events",
    column: "actor_user_id",
    references: "users",
    onDelete: "set null",
  },
];

/** Types as `format_type()` prints them. */
const COLUMN_SHAPES: readonly ColumnShape[] = [
  { table: "organizations", column: "default_currency", type: "character(3)" },
  { table: "invoices", column: "currency", type: "character(3)" },
  { table: "invoices", column: "subtotal_cents", type: "integer" },
  { table: "invoices", column: "tax_rate_bp", type: "integer" },
  { table: "invoices", column: "tax_cents", type: "integer" },
  { table: "invoices", column: "total_cents", type: "integer" },
  { table: "invoices", column: "number", type: "integer", nullable: true },
  { table: "invoices", column: "issue_date", type: "date", nullable: true },
  { table: "invoices", column: "due_date", type: "date", nullable: true },
  { table: "invoices", column: "notes", type: "text", nullable: true },
  { table: "invoice_events", column: "kind", type: "text" },
  {
    table: "invoice_events",
    column: "from_status",
    type: "text",
    nullable: true,
  },
  {
    table: "invoice_events",
    column: "to_status",
    type: "text",
    nullable: true,
  },
  {
    table: "invoice_events",
    column: "actor_user_id",
    type: "uuid",
    nullable: true,
  },
  { table: "invoice_events", column: "note", type: "text", nullable: true },
  {
    table: "invoice_events",
    column: "created_at",
    type: "timestamp with time zone",
  },
  { table: "invoice_line_items", column: "quantity", type: "numeric(12,3)" },
  { table: "invoice_line_items", column: "unit_amount_cents", type: "integer" },
  { table: "invoice_line_items", column: "amount_cents", type: "integer" },
  { table: "deliverables", column: "size_bytes", type: "bigint" },
];

/** `pg_constraint.confdeltype` codes. */
const DELETE_ACTIONS: Readonly<
  Record<string, OnDelete | "no action" | "set default">
> = {
  c: "cascade",
  r: "restrict",
  n: "set null",
  a: "no action",
  d: "set default",
};

type Row = Record<string, unknown>;

type Catalogue = {
  readonly tables: ReadonlySet<string>;
  readonly columns: readonly {
    table: string;
    column: string;
    type: string;
    nullable: boolean;
  }[];
  readonly constraints: readonly {
    table: string;
    name: string;
    kind: string;
    columns: readonly string[];
    references: string | undefined;
    onDelete: string | undefined;
  }[];
  readonly indexes: readonly {
    table: string;
    name: string;
    columns: readonly string[];
    unique: boolean;
  }[];
};

const asString = (value: unknown): string => String(value);

async function readCatalogue(sql: postgres.Sql): Promise<Catalogue> {
  const tables = await sql<Row[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`;

  const columns = await sql<Row[]>`
    select c.relname as table_name,
           a.attname as column_name,
           format_type(a.atttypid, a.atttypmod) as type,
           not a.attnotnull as nullable
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped`;

  const constraints = await sql<Row[]>`
    select c.relname as table_name,
           k.conname as name,
           k.contype as kind,
           array(
             select a.attname from unnest(k.conkey) with ordinality as u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum
             order by u.ord
           ) as columns,
           f.relname as references,
           k.confdeltype as on_delete
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_class f on f.oid = k.confrelid
    where n.nspname = 'public'`;

  const indexes = await sql<Row[]>`
    select c.relname as table_name,
           i.relname as name,
           x.indisunique as is_unique,
           array(
             select a.attname from unnest(x.indkey) with ordinality as u(attnum, ord)
             join pg_attribute a on a.attrelid = x.indrelid and a.attnum = u.attnum
             order by u.ord
           ) as columns
    from pg_index x
    join pg_class c on c.oid = x.indrelid
    join pg_class i on i.oid = x.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'`;

  return {
    tables: new Set(tables.map((row) => asString(row.table_name))),
    columns: columns.map((row) => ({
      table: asString(row.table_name),
      column: asString(row.column_name),
      type: asString(row.type),
      nullable: row.nullable === true,
    })),
    constraints: constraints.map((row) => ({
      table: asString(row.table_name),
      name: asString(row.name),
      kind: asString(row.kind),
      columns: (row.columns as readonly string[]) ?? [],
      references: row.references == null ? undefined : asString(row.references),
      onDelete: row.on_delete == null ? undefined : asString(row.on_delete),
    })),
    indexes: indexes.map((row) => ({
      table: asString(row.table_name),
      name: asString(row.name),
      columns: (row.columns as readonly string[]) ?? [],
      unique: row.is_unique === true,
    })),
  };
}

const sameColumns = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((column, index) => column === b[index]);

/** One line per expectation: what was checked, and the problem if it failed. */
type Finding = { readonly label: string; readonly problem?: string };

function checkTables(catalogue: Catalogue): readonly Finding[] {
  return TABLES.map((table) => ({
    label: `table ${table} exists`,
    problem: catalogue.tables.has(table) ? undefined : "missing",
  }));
}

function checkTenantColumns(catalogue: Catalogue): readonly Finding[] {
  return TENANT_SCOPED.flatMap((table) => {
    const orgId = catalogue.columns.find(
      (column) => column.table === table && column.column === "org_id",
    );
    const leadingIndex = catalogue.indexes.some(
      (index) => index.table === table && index.columns[0] === "org_id",
    );

    return [
      {
        label: `${table}.org_id is uuid not null`,
        problem:
          orgId === undefined
            ? "column missing"
            : orgId.type !== "uuid"
              ? `type is ${orgId.type}`
              : orgId.nullable
                ? "nullable"
                : undefined,
      },
      {
        label: `${table} has an index leading with org_id`,
        problem: leadingIndex ? undefined : "no index leads with org_id",
      },
    ];
  });
}

function checkUniques(catalogue: Catalogue): readonly Finding[] {
  return Object.entries(UNIQUE_CONSTRAINTS).flatMap(([table, sets]) =>
    sets.map((columns) => ({
      label: `unique ${table}(${columns.join(", ")})`,
      problem: catalogue.constraints.some(
        (constraint) =>
          constraint.table === table &&
          constraint.kind === "u" &&
          sameColumns(constraint.columns, columns),
      )
        ? undefined
        : "missing",
    })),
  );
}

function checkChecks(catalogue: Catalogue): readonly Finding[] {
  return Object.entries(CHECK_CONSTRAINTS).flatMap(([table, names]) =>
    names.map((name) => ({
      label: `check ${table}.${name}`,
      problem: catalogue.constraints.some(
        (constraint) =>
          constraint.table === table &&
          constraint.kind === "c" &&
          constraint.name === name,
      )
        ? undefined
        : "missing",
    })),
  );
}

function checkIndexes(catalogue: Catalogue): readonly Finding[] {
  return Object.entries(INDEXES).flatMap(([table, sets]) =>
    sets.map((columns) => ({
      label: `index ${table}(${columns.join(", ")})`,
      problem: catalogue.indexes.some(
        (index) => index.table === table && sameColumns(index.columns, columns),
      )
        ? undefined
        : "missing",
    })),
  );
}

function checkForeignKeys(catalogue: Catalogue): readonly Finding[] {
  return FOREIGN_KEYS.map((expected) => {
    const actual = catalogue.constraints.find(
      (constraint) =>
        constraint.table === expected.table &&
        constraint.kind === "f" &&
        sameColumns(constraint.columns, [expected.column]),
    );
    const onDelete =
      actual?.onDelete === undefined
        ? undefined
        : DELETE_ACTIONS[actual.onDelete];

    return {
      label: `fk ${expected.table}.${expected.column} → ${expected.references} on delete ${expected.onDelete}`,
      problem:
        actual === undefined
          ? "missing"
          : actual.references !== expected.references
            ? `references ${actual.references}`
            : onDelete !== expected.onDelete
              ? `on delete is ${onDelete ?? actual.onDelete}`
              : undefined,
    };
  });
}

function checkColumnShapes(catalogue: Catalogue): readonly Finding[] {
  return COLUMN_SHAPES.map((expected) => {
    const actual = catalogue.columns.find(
      (column) =>
        column.table === expected.table && column.column === expected.column,
    );
    const wantNullable = expected.nullable ?? false;

    return {
      label: `column ${expected.table}.${expected.column} is ${expected.type}${wantNullable ? "" : " not null"}`,
      problem:
        actual === undefined
          ? "missing"
          : actual.type !== expected.type
            ? `type is ${actual.type}`
            : actual.nullable !== wantNullable
              ? actual.nullable
                ? "nullable"
                : "not null"
              : undefined,
    };
  });
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error(
      "DIRECT_URL is not set. This check needs the direct connection.",
    );
    return 1;
  }

  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const catalogue = await readCatalogue(sql);

    const findings: readonly Finding[] = [
      ...checkTables(catalogue),
      ...checkTenantColumns(catalogue),
      ...checkUniques(catalogue),
      ...checkChecks(catalogue),
      ...checkIndexes(catalogue),
      ...checkForeignKeys(catalogue),
      ...checkColumnShapes(catalogue),
    ];

    for (const finding of findings) {
      console.log(
        `${finding.problem === undefined ? "ok  " : "FAIL"}  ${finding.label}${finding.problem === undefined ? "" : `: ${finding.problem}`}`,
      );
    }

    const failures = findings.filter(
      (finding) => finding.problem !== undefined,
    );
    console.log(
      `\n${findings.length - failures.length} of ${findings.length} expectations hold.`,
    );

    return failures.length === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("Could not read the schema.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
