/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-1, AC-3, AC-4, AC-14, AC-15 (every statement the
 * accessor emits carries the tenant predicate, the layer owns `id` and
 * `org_id`, a contact narrows to its own client, a transactional accessor is
 * identical to the pooled one, and a cross tenant miss on a write is logged)
 *
 * `accessor.types.test.ts` proves what the compiler refuses. `tenancy.db.test.ts`
 * proves the behaviour against real PostgreSQL, but it needs `DIRECT_URL` and is
 * skipped without one. This file sits between them: a recording executor
 * captures the statement the accessor built, and the predicate is compared as
 * rendered SQL and bound parameters, which is what PostgreSQL would receive.
 * It runs everywhere, including on a machine with no database.
 */
import type { SQL } from "drizzle-orm";
import { eq, gt } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pool = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./executor", () => ({
  pooledDb: async () => {
    pool.calls += 1;

    return pooledRecorder.executor;
  },
}));

const { tenantDb } = await import("./accessor");

import * as schema from "../schema";
import { clientContacts, clients } from "../schema/clients";
import { invoiceLineItems, invoices } from "../schema/invoices";
import { memberships } from "../schema/identity";
import { deliverables, projects } from "../schema/projects";
import type { InsertValues } from "./accessor";
import type { ContactContext, StaffContext } from "./context";
import type { Executor } from "./executor";
import {
  TENANT_TABLE_KEYS,
  isContactTableKey,
  type ContactTable,
  type TenantTable,
} from "./tables";

const dialect = new PgDialect();

const staff: StaffContext = {
  kind: "staff",
  orgId: "org-row-1",
  clerkOrgId: "org_clerk_1",
  userId: "user-row-1",
  clerkUserId: "user_clerk_1",
  role: "admin",
};

const contact: ContactContext = {
  kind: "contact",
  orgId: "org-row-1",
  userId: "user-row-2",
  clerkUserId: "user_clerk_2",
  clientId: "client-row-1",
  contactId: "contact-row-1",
};

type Recorded = {
  readonly op: "findMany" | "findFirst" | "insert" | "update" | "delete";
  readonly key?: string;
  readonly config?: Record<string, unknown>;
  readonly values?: Record<string, unknown>;
  readonly patch?: Record<string, unknown>;
  readonly where?: SQL;
};

type Recorder = {
  readonly executor: Executor;
  readonly seen: Recorded[];
  rows: Record<string, unknown>[];
  returning: Record<string, unknown>[];
  reset: () => void;
};

/** An executor that records the statement instead of running it. */
function recorder(): Recorder {
  const seen: Recorded[] = [];
  const state = {
    rows: [] as Record<string, unknown>[],
    returning: [] as Record<string, unknown>[],
  };

  const query = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => ({
      findMany: async (config: Record<string, unknown>) => {
        seen.push({ op: "findMany", key: String(key), config });

        return state.rows;
      },
      findFirst: async (config: Record<string, unknown>) => {
        seen.push({ op: "findFirst", key: String(key), config });

        return state.rows[0];
      },
    }),
  });

  const executor = {
    query,
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          seen.push({ op: "insert", values });

          return state.returning;
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: async () => {
            seen.push({ op: "update", patch, where });

            return state.returning;
          },
        }),
      }),
    }),
    delete: () => ({
      where: (where: SQL) => ({
        returning: async () => {
          seen.push({ op: "delete", where });

          return state.returning;
        },
      }),
    }),
  } as unknown as Executor;

  return {
    executor,
    seen,
    get rows() {
      return state.rows;
    },
    set rows(next: Record<string, unknown>[]) {
      state.rows = next;
    },
    get returning() {
      return state.returning;
    },
    set returning(next: Record<string, unknown>[]) {
      state.returning = next;
    },
    reset: () => {
      seen.length = 0;
      state.rows = [];
      state.returning = [];
    },
  };
}

const pooledRecorder = recorder();

/** The rendered statement and its parameters, which is what PostgreSQL sees. */
function render(predicate: SQL): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(predicate);

  return { sql: query.sql, params: query.params };
}

function lastWhere(seen: Recorded[]): SQL {
  const last = seen.at(-1);
  const where = last?.where ?? (last?.config?.where as SQL | undefined);

  if (where === undefined) {
    throw new Error("the recorded statement carried no where clause at all");
  }

  return where;
}

/** Every line console.warn received, captured as text. */
const warned: string[] = [];

beforeEach(() => {
  pool.calls = 0;
  pooledRecorder.reset();
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reads carry the organization predicate", () => {
  it("scopes findMany to the resolved organization", async () => {
    await tenantDb(staff).findMany(clients);

    expect(render(lastWhere(pooledRecorder.seen))).toStrictEqual({
      sql: '"clients"."org_id" = $1',
      params: ["org-row-1"],
    });
  });

  it("scopes findFirst to the resolved organization", async () => {
    await tenantDb(staff).findFirst(projects);

    expect(render(lastWhere(pooledRecorder.seen)).params).toStrictEqual([
      "org-row-1",
    ]);
  });

  it("scopes findById by organization and id together", async () => {
    await tenantDb(staff).findById(invoices, "invoice-row-9");

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe('("invoices"."org_id" = $1 and "invoices"."id" = $2)');
    expect(params).toStrictEqual(["org-row-1", "invoice-row-9"]);
  });

  it("takes the organization from the context, not from anywhere global", async () => {
    await tenantDb({ ...staff, orgId: "org-row-2" }).findMany(clients);

    expect(render(lastWhere(pooledRecorder.seen)).params).toStrictEqual([
      "org-row-2",
    ]);
  });

  it.each(TENANT_TABLE_KEYS)(
    "carries an org_id predicate when reading %s",
    async (key) => {
      const table = schema[key] as unknown as TenantTable;

      await tenantDb(staff).findMany(table);

      expect(render(lastWhere(pooledRecorder.seen)).sql).toContain(
        '"org_id" = $1',
      );
    },
  );

  it("addresses the relational query builder by the table's own schema key", async () => {
    await tenantDb(staff).findMany(invoiceLineItems);

    expect(pooledRecorder.seen.at(-1)?.key).toBe("invoiceLineItems");
  });

  it("hands back the rows the query returned", async () => {
    pooledRecorder.rows = [{ id: "client-row-1" }, { id: "client-row-2" }];

    await expect(tenantDb(staff).findMany(clients)).resolves.toStrictEqual([
      { id: "client-row-1" },
      { id: "client-row-2" },
    ]);
  });

  it("returns an empty list rather than throwing when nothing matched", async () => {
    await expect(tenantDb(staff).findMany(clients)).resolves.toStrictEqual([]);
  });

  it("returns undefined from findFirst when nothing matched", async () => {
    await expect(tenantDb(staff).findFirst(clients)).resolves.toBeUndefined();
  });

  it("returns undefined from findById for another tenant's id, as for one that never existed", async () => {
    // The recorder returns no row, which is exactly what PostgreSQL does once
    // the org_id predicate is applied. The caller cannot tell the two apart,
    // which is the point: a wrong id must not confirm a row exists elsewhere.
    await expect(
      tenantDb(staff).findById(clients, "someone-elses-row"),
    ).resolves.toBeUndefined();
  });
});

describe("the caller's own filter", () => {
  it("is ANDed with the tenant predicate, so it can only narrow further", async () => {
    await tenantDb(staff).findMany(clients, {
      where: eq(clients.name, "Acme"),
    });

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe('("clients"."org_id" = $1 and "clients"."name" = $2)');
    expect(params).toStrictEqual(["org-row-1", "Acme"]);
  });

  it("cannot replace the tenant predicate, however it is written", async () => {
    await tenantDb(staff).findMany(projects, {
      where: gt(projects.createdAt, new Date("2026-01-01T00:00:00.000Z")),
    });

    expect(render(lastWhere(pooledRecorder.seen)).sql).toContain(
      '"projects"."org_id" = $1',
    );
  });

  it("passes orderBy, limit, offset and with through untouched", async () => {
    const orderBy = clients.name;

    await tenantDb(staff).findMany(clients, {
      orderBy,
      limit: 25,
      offset: 50,
      with: { projects: true },
    });

    const config = pooledRecorder.seen.at(-1)?.config;

    expect(config?.orderBy).toBe(orderBy);
    expect(config?.limit).toBe(25);
    expect(config?.offset).toBe(50);
    expect(config?.with).toStrictEqual({ projects: true });
  });

  it("leaves the options undefined when the caller gave none", async () => {
    await tenantDb(staff).findMany(clients);

    const config = pooledRecorder.seen.at(-1)?.config;

    expect(config?.limit).toBeUndefined();
    expect(config?.offset).toBeUndefined();
    expect(config?.with).toBeUndefined();
  });
});

describe("a contact context narrows to its own client as well", () => {
  it("adds the client predicate on top of the organization one", async () => {
    await tenantDb(contact).findMany(clients);

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe('("clients"."org_id" = $1 and "clients"."id" = $2)');
    expect(params).toStrictEqual(["org-row-1", "client-row-1"]);
  });

  it("narrows projects by their client_id column", async () => {
    await tenantDb(contact).findMany(projects);

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe(
      '("projects"."org_id" = $1 and "projects"."client_id" = $2)',
    );
    expect(params).toStrictEqual(["org-row-1", "client-row-1"]);
  });

  it("narrows deliverables through their project", async () => {
    await tenantDb(contact).findMany(deliverables);

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toContain('"deliverables"."org_id" = $1');
    expect(sql).toContain('"deliverables"."project_id" in');
    expect(params).toStrictEqual(["org-row-1", "client-row-1", "org-row-1"]);
  });

  it("narrows invoice line items through their invoice", async () => {
    await tenantDb(contact).findMany(invoiceLineItems);

    const { sql } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toContain('"invoice_line_items"."org_id" = $1');
    expect(sql).toContain('"invoice_line_items"."invoice_id" in');
  });

  it("keeps all three predicates when the caller adds a filter of their own", async () => {
    await tenantDb(contact).findMany(invoices, {
      where: eq(invoices.status, "paid"),
    });

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe(
      '("invoices"."org_id" = $1 and "invoices"."client_id" = $2 and "invoices"."status" = $3)',
    );
    expect(params).toStrictEqual(["org-row-1", "client-row-1", "paid"]);
  });

  it("scopes findById by organization, client and id", async () => {
    await tenantDb(contact).findById(clientContacts, "contact-row-9");

    const { params } = render(lastWhere(pooledRecorder.seen));

    expect(params).toStrictEqual([
      "org-row-1",
      "client-row-1",
      "contact-row-9",
    ]);
  });

  it.each(TENANT_TABLE_KEYS.filter(isContactTableKey))(
    "carries both predicates when a contact reads %s",
    async (key) => {
      const table = schema[key] as unknown as ContactTable;

      await tenantDb(contact).findMany(table);

      const { params } = render(lastWhere(pooledRecorder.seen));

      expect(params[0]).toBe("org-row-1");
      expect(params).toContain("client-row-1");
    },
  );

  it("refuses loudly for a table with no client path, rather than handing over the organization", async () => {
    // `ContactAccessor` cannot name `memberships`, so this is unreachable
    // through the typed surface. The cast is the point: if a future refactor
    // lets one through, it must throw rather than quietly return every member.
    const escaped = tenantDb(contact) as unknown as {
      findMany: (table: TenantTable) => Promise<unknown>;
    };

    await expect(escaped.findMany(memberships)).rejects.toThrow(
      /memberships has no client path/u,
    );
  });
});

describe("insert", () => {
  it("mints the id and stamps the organization itself", async () => {
    pooledRecorder.returning = [{ id: "generated" }];

    await tenantDb(staff).insert(clients, { name: "Acme" });

    const values = pooledRecorder.seen.at(-1)?.values ?? {};

    expect(values.orgId).toBe("org-row-1");
    expect(values.name).toBe("Acme");
    expect(values.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("mints a fresh id for each row, so two inserts never collide", async () => {
    pooledRecorder.returning = [{ id: "generated" }];

    await tenantDb(staff).insert(clients, { name: "Acme" });
    await tenantDb(staff).insert(clients, { name: "Globex" });

    const ids = pooledRecorder.seen
      .filter((call) => call.op === "insert")
      .map((call) => call.values?.id);

    expect(new Set(ids).size).toBe(2);
  });

  it("overrides an org_id a caller managed to sneak past the type", async () => {
    pooledRecorder.returning = [{ id: "generated" }];

    // `InsertValues` types `orgId` as `never`, so no real call site can do
    // this. The cast proves the runtime does not rely on the type alone: a row
    // cannot be planted in another organization.
    const smuggled = {
      name: "Acme",
      orgId: "org-row-2",
      id: "attacker-chosen-id",
    } as unknown as InsertValues<typeof clients>;

    await tenantDb(staff).insert(clients, smuggled);

    const values = pooledRecorder.seen.at(-1)?.values ?? {};

    expect(values.orgId).toBe("org-row-1");
    expect(values.id).not.toBe("attacker-chosen-id");
  });

  it("returns the row the database gave back", async () => {
    pooledRecorder.returning = [{ id: "client-row-1", name: "Acme" }];

    await expect(
      tenantDb(staff).insert(clients, { name: "Acme" }),
    ).resolves.toStrictEqual({ id: "client-row-1", name: "Acme" });
  });

  it("says nothing to the log on a successful insert", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).insert(clients, { name: "Acme" });

    expect(warned).toHaveLength(0);
  });
});

describe("update", () => {
  it("scopes the statement by organization and id", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).update(clients, "client-row-1", { name: "Acme Ltd" });

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe('("clients"."org_id" = $1 and "clients"."id" = $2)');
    expect(params).toStrictEqual(["org-row-1", "client-row-1"]);
  });

  it("applies the caller's patch and nothing else", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).update(clients, "client-row-1", { name: "Acme Ltd" });

    expect(pooledRecorder.seen.at(-1)?.patch).toStrictEqual({
      name: "Acme Ltd",
    });
  });

  it("returns the updated row", async () => {
    pooledRecorder.returning = [{ id: "client-row-1", name: "Acme Ltd" }];

    await expect(
      tenantDb(staff).update(clients, "client-row-1", { name: "Acme Ltd" }),
    ).resolves.toStrictEqual({ id: "client-row-1", name: "Acme Ltd" });
  });

  it("returns undefined when the id belongs to another tenant", async () => {
    await expect(
      tenantDb(staff).update(clients, "someone-elses-row", { name: "Mine" }),
    ).resolves.toBeUndefined();
  });

  it("logs exactly one line for a cross tenant miss, naming the table", async () => {
    await tenantDb(staff).update(projects, "someone-elses-row", {
      name: "Mine",
    });

    expect(warned).toHaveLength(1);

    const [raw] = warned;
    const line: unknown = JSON.parse(raw);

    expect(line).toMatchObject({
      event: "tenant.refusal",
      operation: "update:projects",
      reason: "not_found",
      userId: "user-row-1",
      orgId: "org-row-1",
    });
  });

  it("never puts the requested id or the patch in the log line", async () => {
    await tenantDb(staff).update(clients, "someone-elses-row", {
      name: "Confidential Ltd",
    });

    const [raw] = warned;

    expect(raw).not.toContain("someone-elses-row");
    expect(raw).not.toContain("Confidential Ltd");
  });

  it("says nothing to the log on a hit", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).update(clients, "client-row-1", { name: "Acme Ltd" });

    expect(warned).toHaveLength(0);
  });
});

describe("delete", () => {
  it("scopes the statement by organization and id", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).delete(clients, "client-row-1");

    const { sql, params } = render(lastWhere(pooledRecorder.seen));

    expect(sql).toBe('("clients"."org_id" = $1 and "clients"."id" = $2)');
    expect(params).toStrictEqual(["org-row-1", "client-row-1"]);
  });

  it("reports true when a row was removed", async () => {
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await expect(tenantDb(staff).delete(clients, "client-row-1")).resolves.toBe(
      true,
    );
    expect(warned).toHaveLength(0);
  });

  it("reports false for an id belonging to another tenant", async () => {
    await expect(
      tenantDb(staff).delete(clients, "someone-elses-row"),
    ).resolves.toBe(false);
  });

  it("logs exactly one line for a cross tenant miss, naming the table", async () => {
    await tenantDb(staff).delete(deliverables, "someone-elses-row");

    expect(warned).toHaveLength(1);

    const [raw] = warned;
    const line: unknown = JSON.parse(raw);

    expect(line).toMatchObject({
      operation: "delete:deliverables",
      reason: "not_found",
    });
  });
});

describe("a transactional accessor", () => {
  it("runs on the executor it was given and never reaches for the pool", async () => {
    const tx = recorder();

    await tenantDb(staff, tx.executor).findMany(clients);

    expect(tx.seen).toHaveLength(1);
    expect(pool.calls).toBe(0);
    expect(pooledRecorder.seen).toHaveLength(0);
  });

  it("carries predicates identical to the pooled accessor, on a read", async () => {
    const tx = recorder();

    await tenantDb(contact).findMany(invoices);
    await tenantDb(contact, tx.executor).findMany(invoices);

    expect(render(lastWhere(tx.seen))).toStrictEqual(
      render(lastWhere(pooledRecorder.seen)),
    );
  });

  it("carries predicates identical to the pooled accessor, on a write", async () => {
    const tx = recorder();
    tx.returning = [{ id: "client-row-1" }];
    pooledRecorder.returning = [{ id: "client-row-1" }];

    await tenantDb(staff).update(clients, "client-row-1", { name: "Acme Ltd" });
    await tenantDb(staff, tx.executor).update(clients, "client-row-1", {
      name: "Acme Ltd",
    });

    expect(render(lastWhere(tx.seen))).toStrictEqual(
      render(lastWhere(pooledRecorder.seen)),
    );
  });

  it("still stamps the organization on an insert inside a transaction", async () => {
    const tx = recorder();
    tx.returning = [{ id: "client-row-1" }];

    await tenantDb(staff, tx.executor).insert(clients, { name: "Acme" });

    expect(tx.seen.at(-1)?.values?.orgId).toBe("org-row-1");
  });

  it("still refuses a contact reading a table with no client path", async () => {
    const tx = recorder();
    const escaped = tenantDb(contact, tx.executor) as unknown as {
      findMany: (table: TenantTable) => Promise<unknown>;
    };

    await expect(escaped.findMany(memberships)).rejects.toThrow(
      /has no client path/u,
    );
  });
});

describe("the pooled handle", () => {
  it("is fetched only when a statement actually runs", async () => {
    tenantDb(staff);

    expect(pool.calls).toBe(0);

    await tenantDb(staff).findMany(clients);

    expect(pool.calls).toBe(1);
  });
});
