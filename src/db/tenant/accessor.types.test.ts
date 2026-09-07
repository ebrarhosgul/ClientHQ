/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-1, AC-3, AC-4 (the parts the compiler proves)
 *
 * These cases are checked by `pnpm typecheck`, not at runtime. Every
 * `@ts-expect-error` below *fails the build* if the error it expects stops
 * happening, which is what turns "you cannot write an unscoped query" from a
 * claim into a gate. The single runtime assertion at the bottom is only there
 * so Vitest counts the file.
 */
import { describe, expect, it } from "vitest";

import {
  clientContacts,
  clients,
  deliverables,
  invoiceLineItems,
  invoices,
  memberships,
  organizations,
  processedWebhookEvents,
  projects,
  subscriptions,
  users,
} from "../schema";
import { tenantDb } from "./accessor";
import type { ContactContext, StaffContext } from "./context";

const staff: StaffContext = {
  kind: "staff",
  orgId: "11111111-1111-4111-8111-111111111111",
  clerkOrgId: "org_1",
  userId: "22222222-2222-4222-8222-222222222222",
  clerkUserId: "user_1",
  role: "admin",
};

const contact: ContactContext = {
  kind: "contact",
  orgId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  clerkUserId: "user_1",
  clientId: "33333333-3333-4333-8333-333333333333",
  contactId: "44444444-4444-4444-8444-444444444444",
};

/** Nothing below is executed; it exists to be typechecked. */
async function staffSurface(): Promise<void> {
  const db = tenantDb(staff);

  // Every tenant scoped table is reachable, on every method.
  await db.findMany(clients);
  await db.findMany(clientContacts);
  await db.findMany(memberships);
  await db.findMany(subscriptions);
  await db.findMany(projects);
  await db.findMany(deliverables);
  await db.findMany(invoices);
  await db.findMany(invoiceLineItems);
  await db.findById(projects, "id");
  await db.delete(clients, "id");

  // AC-1: a table with no `org_id` cannot be passed at all.
  // @ts-expect-error organizations is the tenant root, not a tenant scoped table
  await db.findMany(organizations);
  // @ts-expect-error users is not tenant scoped
  await db.findMany(users);
  // @ts-expect-error processed_webhook_events is not tenant scoped
  await db.findMany(processedWebhookEvents);
  // @ts-expect-error the same guarantee on the write path
  await db.insert(users, { clerkUserId: "x", email: "a@b.com" });

  // AC-3: the layer owns `id` and `org_id` on the way in.
  await db.insert(clients, { name: "Acme" });
  // @ts-expect-error org_id is set from the context, never supplied
  await db.insert(clients, { name: "Acme", orgId: staff.orgId });
  // @ts-expect-error id comes from newId(), never supplied
  await db.insert(clients, { name: "Acme", id: "chosen" });

  // AC-3: and no write can move a row into another organization.
  await db.update(clients, "id", { name: "Renamed" });
  // @ts-expect-error moving a row between organizations does not compile
  await db.update(clients, "id", { orgId: "another-org" });
  // @ts-expect-error nor does rewriting its id
  await db.update(clients, "id", { id: "another-id" });
  // @ts-expect-error nor its created_at
  await db.update(clients, "id", { createdAt: new Date() });

  // Relations load, and come back typed.
  const withProjects = await db.findMany(clients, { with: { projects: true } });
  const projectName: string | undefined = withProjects[0]?.projects[0]?.name;
  void projectName;
}

async function contactSurface(): Promise<void> {
  const db = tenantDb(contact);

  // The six tables with a path to a client.
  await db.findMany(clients);
  await db.findMany(clientContacts);
  await db.findMany(projects);
  await db.findMany(deliverables);
  await db.findMany(invoices);
  await db.findMany(invoiceLineItems);

  // AC-4: the two with no client path are unreachable at compile time.
  // @ts-expect-error a contact cannot address memberships
  await db.findMany(memberships);
  // @ts-expect-error a contact cannot address subscriptions
  await db.findMany(subscriptions);

  // AC-4: writes are absent from the type, not merely refused at runtime.
  // @ts-expect-error a contact accessor has no insert
  await db.insert(clients, { name: "Acme" });
  // @ts-expect-error a contact accessor has no update
  await db.update(clients, "id", { name: "Acme" });
  // @ts-expect-error a contact accessor has no delete
  await db.delete(clients, "id");
}

describe("the accessor's compile time surface", () => {
  it("is proven by typecheck, not by running", () => {
    expect(typeof staffSurface).toBe("function");
    expect(typeof contactSurface).toBe("function");
  });
});
