/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-1 and AC-4 (coverage is derived from the schema rather
 * than listed, and a contact context narrows through one of exactly three
 * shapes)
 *
 * `accessor.types.test.ts` proves the compile time half: an unscoped table does
 * not typecheck. This file proves the runtime half, which is what actually
 * builds the SQL. The predicates are compared as rendered SQL and parameters,
 * because that is the thing PostgreSQL sees; comparing Drizzle's own objects
 * would pass while emitting the wrong statement.
 */
import { pgTable, text, uuid, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../schema";
import { clientContacts, clients } from "../schema/clients";
import { invoiceEvents, invoiceLineItems, invoices } from "../schema/invoices";
import { deliverables, projects } from "../schema/projects";
import { memberships, organizations, users } from "../schema/identity";
import { processedWebhookEvents } from "../schema/webhooks";
import type { ContactContext } from "./context";
import {
  TENANT_TABLE_KEYS,
  clientPredicate,
  isContactTableKey,
  orgPredicate,
  relationalKey,
  type ContactTableKey,
  type TenantTable,
} from "./tables";

const dialect = new PgDialect();

const contact: ContactContext = {
  kind: "contact",
  orgId: "org-row-1",
  userId: "user-row-2",
  clerkUserId: "user_clerk_2",
  clientId: "client-row-1",
  contactId: "contact-row-1",
};

/** The rendered statement and its parameters, which is what PostgreSQL sees. */
function render(predicate: Parameters<PgDialect["sqlToQuery"]>[0]): {
  sql: string;
  params: unknown[];
} {
  const query = dialect.sqlToQuery(predicate);

  return { sql: query.sql, params: query.params };
}

describe("TENANT_TABLE_KEYS", () => {
  it("is exactly the nine tables carrying org_id", () => {
    expect([...TENANT_TABLE_KEYS]).toStrictEqual([
      "clientContacts",
      "clients",
      "deliverables",
      "invoiceEvents",
      "invoiceLineItems",
      "invoices",
      "memberships",
      "projects",
      "subscriptions",
    ]);
  });

  it("leaves out the tables that have no tenant, so they cannot be scoped", () => {
    expect(TENANT_TABLE_KEYS).not.toContain("organizations");
    expect(TENANT_TABLE_KEYS).not.toContain("users");
    expect(TENANT_TABLE_KEYS).not.toContain("processedWebhookEvents");
  });

  it("is derived from the schema, not hand written", () => {
    // Every key names a real export, and every export with an `orgId` column is
    // in the list. A table added in a later slice therefore joins by existing.
    const derived = Object.entries(schema)
      .filter(
        ([, value]) =>
          typeof value === "object" &&
          value !== null &&
          "orgId" in value &&
          "id" in value,
      )
      .map(([key]) => key)
      .sort();

    expect([...TENANT_TABLE_KEYS]).toStrictEqual(derived);
  });

  it("cannot be mutated by a caller", () => {
    expect(Object.isFrozen(TENANT_TABLE_KEYS)).toBe(true);
  });
});

describe("relationalKey", () => {
  it.each([
    [clients, "clients"],
    [clientContacts, "clientContacts"],
    [projects, "projects"],
    [deliverables, "deliverables"],
    [invoices, "invoices"],
    [invoiceLineItems, "invoiceLineItems"],
    [invoiceEvents, "invoiceEvents"],
    [memberships, "memberships"],
  ])("maps a table object onto its db.query key", (table, key) => {
    expect(relationalKey(table as TenantTable)).toBe(key);
  });

  it("throws loudly for a table the schema does not export, rather than running unscoped", () => {
    const stray = pgTable("stray", {
      id: uuid("id").primaryKey(),
      orgId: uuid("org_id").notNull(),
      name: text("name"),
    });

    expect(() => relationalKey(stray)).toThrow(
      /is not exported from src\/db\/schema/u,
    );
  });
});

describe("orgPredicate", () => {
  it("is org_id = the resolved organization, as a bound parameter", () => {
    expect(render(orgPredicate(clients, "org-row-1"))).toStrictEqual({
      sql: '"clients"."org_id" = $1',
      params: ["org-row-1"],
    });
  });

  it("binds the organization rather than interpolating it into the statement", () => {
    const injected = "org-row-1' or '1'='1";

    const { sql, params } = render(orgPredicate(projects, injected));

    expect(sql).toBe('"projects"."org_id" = $1');
    expect(params).toStrictEqual([injected]);
  });

  it.each([
    [clients, "clients"],
    [clientContacts, "client_contacts"],
    [projects, "projects"],
    [deliverables, "deliverables"],
    [invoices, "invoices"],
    [invoiceLineItems, "invoice_line_items"],
    [invoiceEvents, "invoice_events"],
    [memberships, "memberships"],
  ])("names the %s table's own org_id column", (table, sqlName) => {
    expect(render(orgPredicate(table as TenantTable, "org-row-1")).sql).toBe(
      `"${sqlName}"."org_id" = $1`,
    );
  });
});

describe("isContactTableKey", () => {
  it.each([
    "clients",
    "clientContacts",
    "projects",
    "invoices",
    "deliverables",
    "invoiceLineItems",
    "invoiceEvents",
  ])("accepts %s, which has a path to a client", (key) => {
    expect(isContactTableKey(key)).toBe(true);
  });

  it.each(["memberships", "subscriptions"])(
    "rejects %s, which a contact must never reach",
    (key) => {
      expect(isContactTableKey(key)).toBe(false);
    },
  );

  it.each(["organizations", "users", "processedWebhookEvents", ""])(
    "rejects %s",
    (key) => {
      expect(isContactTableKey(key)).toBe(false);
    },
  );

  it.each(["toString", "constructor", "hasOwnProperty", "__proto__"])(
    "rejects the inherited property name %s",
    (key) => {
      // The guard uses `key in CLIENT_PREDICATES`, and `in` walks the
      // prototype chain, so every Object.prototype member answers true and
      // `clientPredicate` would then call it as though it were a predicate
      // builder. Unreachable today, because the only caller passes a key
      // derived from the schema's own exports, but this is a guard on the
      // contact boundary and it should answer for itself. `Object.hasOwn` is
      // the one word fix.
      expect(isContactTableKey(key)).toBe(false);
    },
  );

  it("agrees with the tenant table list: seven of the nine are reachable", () => {
    const reachable = TENANT_TABLE_KEYS.filter(isContactTableKey);

    expect(reachable).toHaveLength(7);
  });
});

describe("clientPredicate", () => {
  it("narrows clients to the contact's own client row by id", () => {
    expect(render(clientPredicate("clients", contact))).toStrictEqual({
      sql: '"clients"."id" = $1',
      params: ["client-row-1"],
    });
  });

  it("narrows clientContacts by its client_id column", () => {
    expect(render(clientPredicate("clientContacts", contact))).toStrictEqual({
      sql: '"client_contacts"."client_id" = $1',
      params: ["client-row-1"],
    });
  });

  it("narrows projects by its client_id column", () => {
    expect(render(clientPredicate("projects", contact))).toStrictEqual({
      sql: '"projects"."client_id" = $1',
      params: ["client-row-1"],
    });
  });

  it("narrows invoices by its client_id column", () => {
    expect(render(clientPredicate("invoices", contact))).toStrictEqual({
      sql: '"invoices"."client_id" = $1',
      params: ["client-row-1"],
    });
  });

  it("narrows deliverables through their project, scoped by client and organization", () => {
    const { sql, params } = render(clientPredicate("deliverables", contact));

    expect(sql).toContain('"deliverables"."project_id" in');
    expect(sql).toContain('from "projects"');
    expect(sql).toContain('"projects"."client_id" = $1');
    expect(sql).toContain('"projects"."org_id" = $2');
    expect(params).toStrictEqual(["client-row-1", "org-row-1"]);
  });

  it("narrows invoice line items through their invoice, scoped by client and organization", () => {
    const { sql, params } = render(
      clientPredicate("invoiceLineItems", contact),
    );

    expect(sql).toContain('"invoice_line_items"."invoice_id" in');
    expect(sql).toContain('from "invoices"');
    expect(sql).toContain('"invoices"."client_id" = $1');
    expect(sql).toContain('"invoices"."org_id" = $2');
    expect(params).toStrictEqual(["client-row-1", "org-row-1"]);
  });

  it("narrows invoice events through their invoice, scoped by client and organization", () => {
    const { sql, params } = render(clientPredicate("invoiceEvents", contact));

    expect(sql).toContain('"invoice_events"."invoice_id" in');
    expect(sql).toContain('from "invoices"');
    expect(sql).toContain('"invoices"."client_id" = $1');
    expect(sql).toContain('"invoices"."org_id" = $2');
    expect(params).toStrictEqual(["client-row-1", "org-row-1"]);
  });

  it("carries the organization into the indirect sub selects too, not the client alone", () => {
    // Without the org_id in the sub select, a project id belonging to another
    // organization that happened to carry the same client id would qualify.
    for (const key of [
      "deliverables",
      "invoiceLineItems",
      "invoiceEvents",
    ] as const) {
      expect(render(clientPredicate(key, contact)).params).toContain(
        "org-row-1",
      );
    }
  });

  it("binds the client id rather than interpolating it", () => {
    const injected = "client-row-1' or '1'='1";
    const forged: ContactContext = { ...contact, clientId: injected };

    for (const key of [
      "clients",
      "clientContacts",
      "projects",
      "invoices",
      "deliverables",
      "invoiceLineItems",
      "invoiceEvents",
    ] as const satisfies readonly ContactTableKey[]) {
      const { sql, params } = render(clientPredicate(key, forged));

      expect(sql).not.toContain(injected);
      expect(params).toContain(injected);
    }
  });

  it("covers every contact reachable table, so none falls through to no predicate", () => {
    for (const key of TENANT_TABLE_KEYS.filter(isContactTableKey)) {
      expect(() => clientPredicate(key, contact)).not.toThrow();
    }
  });
});

describe("the tables with no tenant", () => {
  it.each([
    ["organizations", organizations],
    ["users", users],
    ["processedWebhookEvents", processedWebhookEvents],
  ])("has no org_id column, so %s cannot be scoped at all", (_name, table) => {
    expect("orgId" in table).toBe(false);
  });
});
