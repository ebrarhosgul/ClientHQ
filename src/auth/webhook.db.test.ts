/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8, AC-9, AC-10,
 * AC-11, AC-12, AC-13, AC-16
 *
 * The Clerk webhook against real SQL, on the shape of
 * `src/payments/webhook.db.test.ts`: replay, ordering, the row lock, the
 * rollback and the cascades are all claims about the database, and a fake
 * would agree with a bug PostgreSQL will not.
 *
 * Clerk itself is faked, through the same `ClerkGateway` interface
 * `liveClerkGateway()` implements, so no network, no Clerk key and no account
 * is needed. Signature verification is deliberately *not* faked: every
 * delivery here is signed for real with `CLERK_WEBHOOK_SIGNING_SECRET` (the
 * placeholder value `.env` carries), through the same `verifyWebhook` the
 * route calls, which is what proves AC-1 rather than assuming it.
 *
 * One file rather than the two the build plan sketches (a separate fake-`db`
 * unit file plus this one): `src/payments/webhook.ts` never grew that split
 * either, a hand rolled fake of Drizzle's chainable query builder would be a
 * second implementation to keep in sync with the real one, and everything the
 * plan wanted from a fake `db` - replay, reverse order, every refusal, the
 * 500 paths - is exercised here against the real thing instead, which is
 * strictly more convincing.
 *
 * Each case makes its own organization and user and deletes them afterwards,
 * so this can be pointed at a development project as safely as at CI's
 * container. Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs
 * without a database.
 */
import { createHmac, randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  clientContacts,
  clients,
  memberships,
  organizations,
  processedWebhookEvents,
  subscriptions,
  users,
} from "@/db/schema";
import type { Database } from "@/db/tenant";
import { env } from "@/lib/env";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import type { ClerkGateway } from "./clerk";
import {
  CLERK_WEBHOOK_EVENTS,
  handleClerkWebhook,
  type ClerkWebhookEventType,
} from "./webhook";

loadEnvFiles();

const url = process.env.DIRECT_URL;

// More than one connection on purpose: the concurrency case needs two
// deliveries genuinely in flight at once for the row lock to mean anything.
const sql = postgres(url ?? "", { prepare: false, max: 4 });
const db: Database = drizzle(sql, { schema });

/** Everything this file created, torn down after each case. */
const createdOrgs: string[] = [];
const createdUsers: string[] = [];
const createdEvents: string[] = [];

function clerkId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/**
 * A tag unique enough for a slug or an email local part, drawn from
 * `randomUUID()` rather than `newId()`'s time ordered bits: this suite runs
 * concurrently with every other `*.db.test.ts` file against one shared
 * database, and a millisecond timestamp prefix collides across files under
 * that load in a way a fully random one does not.
 */
function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

async function makeOrganization(
  patch: { readonly clerkOrgId?: string; readonly deletedAt?: Date } = {},
): Promise<{ readonly id: string; readonly clerkOrgId: string }> {
  const id = newId();
  const clerkOrgId = patch.clerkOrgId ?? clerkId("org");
  const unique = tag();

  await db.insert(organizations).values({
    id,
    clerkOrgId,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
    deletedAt: patch.deletedAt,
  });

  createdOrgs.push(id);

  return { id, clerkOrgId };
}

async function makeUser(
  patch: { readonly clerkUserId?: string; readonly deletedAt?: Date } = {},
): Promise<{ readonly id: string; readonly clerkUserId: string }> {
  const id = newId();
  const clerkUserId = patch.clerkUserId ?? clerkId("user");
  const unique = tag();

  await db.insert(users).values({
    id,
    clerkUserId,
    email: `person-${unique}@northwind.test`,
    name: `Person ${unique}`,
    deletedAt: patch.deletedAt,
  });

  createdUsers.push(id);

  return { id, clerkUserId };
}

/** The signature `verifyWebhook` expects, computed the same way it does. */
function sign(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const toSign = `${id}.${timestamp}.${body}`;

  return `v1,${createHmac("sha256", key).update(toSign).digest("base64")}`;
}

type EventInput = {
  readonly type: ClerkWebhookEventType | (string & {});
  readonly data: unknown;
};

/** A genuinely signed request, exactly as Clerk's relay would send one. */
function signedRequest(
  event: EventInput,
  options: {
    readonly id?: string;
    readonly withoutSignature?: boolean;
    readonly badSignature?: boolean;
  } = {},
): NextRequest {
  const body = JSON.stringify({
    type: event.type,
    object: "event",
    data: event.data,
  });
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);

  createdEvents.push(id);

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (options.withoutSignature !== true) {
    headers["svix-id"] = id;
    headers["svix-timestamp"] = String(timestamp);
    headers["svix-signature"] =
      options.badSignature === true
        ? "v1,not-a-real-signature=="
        : sign(env().CLERK_WEBHOOK_SIGNING_SECRET, id, timestamp, body);
  }

  return new NextRequest("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers,
    body,
  });
}

type GatewayState = {
  organizations: Map<
    string,
    { readonly clerkOrgId: string; readonly name: string } | "gone"
  >;
  users: Map<
    string,
    | {
        readonly clerkUserId: string;
        readonly email: string;
        readonly name: string | undefined;
        readonly imageUrl: string | undefined;
      }
    | "gone"
  >;
  memberships: Map<string, string | "gone">;
  calls: {
    getUser: number;
    getOrganization: number;
    getOrganizationMembership: number;
  };
};

function newGatewayState(): GatewayState {
  return {
    organizations: new Map(),
    users: new Map(),
    memberships: new Map(),
    calls: { getUser: 0, getOrganization: 0, getOrganizationMembership: 0 },
  };
}

function fakeGateway(state: GatewayState): ClerkGateway {
  return {
    getUser: async (clerkUserId) => {
      state.calls.getUser += 1;
      const entry = state.users.get(clerkUserId);

      return entry === undefined || entry === "gone"
        ? { present: false }
        : { present: true, value: entry };
    },

    getOrganization: async (clerkOrgId) => {
      state.calls.getOrganization += 1;
      const entry = state.organizations.get(clerkOrgId);

      return entry === undefined || entry === "gone"
        ? { present: false }
        : { present: true, value: entry };
    },

    getOrganizationMembership: async ({ clerkOrgId, clerkUserId }) => {
      state.calls.getOrganizationMembership += 1;
      const role = state.memberships.get(`${clerkOrgId}:${clerkUserId}`);

      return role === undefined || role === "gone"
        ? { present: false }
        : { present: true, value: { role } };
    },
  };
}

function deliver(
  gateway: ClerkGateway,
  event: EventInput,
  options: Parameters<typeof signedRequest>[1] & {
    readonly handle?: Database;
  } = {},
) {
  return handleClerkWebhook({
    db: options.handle ?? db,
    gateway,
    request: signedRequest(event, options),
  });
}

async function ledgerCount(eventId: string): Promise<number> {
  const rows = await db
    .select({ id: processedWebhookEvents.id })
    .from(processedWebhookEvents)
    .where(
      and(
        eq(processedWebhookEvents.source, "clerk"),
        eq(processedWebhookEvents.eventId, eventId),
      ),
    );

  return rows.length;
}

async function organizationRow(id: string) {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  return row;
}

async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return row;
}

async function membershipRows(orgId: string, userId?: string) {
  return db
    .select()
    .from(memberships)
    .where(
      userId === undefined
        ? eq(memberships.orgId, orgId)
        : and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
    );
}

/**
 * A handle whose write to one named table throws, so a rollback can be
 * proven without needing a genuine unique violation to manufacture one.
 * Mirrors `dbThatFailsApplying` in `src/payments/webhook.db.test.ts`.
 */
function dbThatFailsWriting(
  real: Database,
  table: typeof organizations | typeof memberships,
): Database {
  return new Proxy(real, {
    get(target, property, receiver: unknown) {
      if (property !== "transaction") {
        return Reflect.get(target, property, receiver);
      }

      return (run: (tx: unknown) => Promise<unknown>, config?: unknown) =>
        target.transaction(
          (tx) =>
            run(
              new Proxy(tx, {
                get(txTarget, txProperty, txReceiver: unknown) {
                  if (txProperty !== "insert" && txProperty !== "update") {
                    return Reflect.get(txTarget, txProperty, txReceiver);
                  }

                  return (writtenTable: unknown) => {
                    if (writtenTable === table) {
                      throw new Error(
                        `connection reset writing (${String(txProperty)})`,
                      );
                    }

                    return (
                      txTarget[txProperty as "insert"] as (
                        t: unknown,
                      ) => unknown
                    )(writtenTable);
                  };
                },
              }) as never,
            ) as never,
          config as never,
        );
    },
  }) as Database;
}

afterEach(async () => {
  if (createdEvents.length > 0) {
    await db
      .delete(processedWebhookEvents)
      .where(inArray(processedWebhookEvents.eventId, createdEvents));
    createdEvents.length = 0;
  }

  if (createdOrgs.length > 0) {
    // `memberships.org_id` and `client_contacts.org_id` cascade with it.
    await db
      .delete(organizations)
      .where(inArray(organizations.id, createdOrgs));
    createdOrgs.length = 0;
  }

  if (createdUsers.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUsers));
    createdUsers.length = 0;
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("the Clerk webhook against real PostgreSQL", () => {
  describe("verification (AC-1)", () => {
    it("answers 400 and touches neither the gateway nor the database when unsigned", async () => {
      const state = newGatewayState();

      const result = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: clerkId("org") } },
        { withoutSignature: true },
      );

      expect(result).toMatchObject({ status: 400, outcome: "unverified" });
      expect(state.calls).toEqual({
        getUser: 0,
        getOrganization: 0,
        getOrganizationMembership: 0,
      });
    });

    it("answers 400 for a signature that does not verify", async () => {
      const state = newGatewayState();

      const result = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: clerkId("org") } },
        { badSignature: true },
      );

      expect(result).toMatchObject({ status: 400, outcome: "unverified" });
      expect(state.calls.getOrganization).toBe(0);
    });
  });

  describe("the eight event filter (AC-2)", () => {
    it("acts on all eight subscribed events without throwing", () => {
      expect(CLERK_WEBHOOK_EVENTS).toHaveLength(8);
    });

    it("ignores a verified event outside the subscribed eight, user.created included", async () => {
      const state = newGatewayState();

      const result = await deliver(fakeGateway(state), {
        type: "user.created",
        data: { id: clerkId("user") },
      });

      expect(result).toMatchObject({ status: 200, outcome: "ignored" });
      expect(state.calls.getUser).toBe(0);
    });

    it("ignores session.created the same way", async () => {
      const result = await deliver(fakeGateway(newGatewayState()), {
        type: "session.created",
        data: {},
      });

      expect(result).toMatchObject({ status: 200, outcome: "ignored" });
    });
  });

  describe("organization.updated (AC-5)", () => {
    it("upserts the name from the re read, not from the payload", async () => {
      const org = await makeOrganization();
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: "Renamed Northwind",
      });

      const result = await deliver(fakeGateway(state), {
        type: "organization.updated",
        // Deliberately a different name: the payload is a pointer, never state.
        data: { id: org.clerkOrgId, name: "Whatever The Payload Said" },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect((await organizationRow(org.id))?.name).toBe("Renamed Northwind");
    });

    it("creates the row on organization.created for an agency never seen before", async () => {
      const clerkOrgId = clerkId("org");
      const state = newGatewayState();
      state.organizations.set(clerkOrgId, { clerkOrgId, name: "Fresh Agency" });

      const result = await deliver(fakeGateway(state), {
        type: "organization.created",
        data: { id: clerkOrgId },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });

      const [row] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId));

      expect(row?.name).toBe("Fresh Agency");
      if (row !== undefined) {
        createdOrgs.push(row.id);
      }
    });
  });

  describe("the same delivery twice (AC-3)", () => {
    it("changes nothing the second time and still answers 200", async () => {
      const org = await makeOrganization();
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: "First Name",
      });
      const svixId = `msg_${randomUUID()}`;

      const first = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: org.clerkOrgId } },
        { id: svixId },
      );

      expect(first).toMatchObject({ status: 200, outcome: "handled" });

      // A different state, to prove the replay applies nothing.
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: "Second Name",
      });

      const second = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: org.clerkOrgId } },
        { id: svixId },
      );

      expect(second).toMatchObject({ status: 200, outcome: "duplicate" });
      expect(await ledgerCount(svixId)).toBe(1);
      expect((await organizationRow(org.id))?.name).toBe("First Name");
    });
  });

  describe("out of order deliveries (AC-4)", () => {
    it("leaves the row holding what Clerk currently reports, whichever payload arrived last", async () => {
      const user = await makeUser();
      const state = newGatewayState();

      // Two user.updated deliveries whose *payloads* carry the old and new
      // name in reverse order; the re read answers the current name both
      // times, so the mirror holds it regardless of delivery order.
      state.users.set(user.clerkUserId, {
        clerkUserId: user.clerkUserId,
        email: "current@northwind.test",
        name: "Current Name",
        imageUrl: undefined,
      });

      const first = await deliver(fakeGateway(state), {
        type: "user.updated",
        data: { id: user.clerkUserId, first_name: "New" },
      });
      const second = await deliver(fakeGateway(state), {
        type: "user.updated",
        data: { id: user.clerkUserId, first_name: "Old" },
      });

      expect(first).toMatchObject({ status: 200, outcome: "handled" });
      expect(second).toMatchObject({ status: 200, outcome: "handled" });
      expect((await userRow(user.id))?.name).toBe("Current Name");
      expect((await userRow(user.id))?.email).toBe("current@northwind.test");
    });
  });

  describe("membership before organization or user exist locally (AC-10)", () => {
    it("creates all three rows in one transaction", async () => {
      const clerkOrgId = clerkId("org");
      const clerkUserId = clerkId("user");
      const state = newGatewayState();
      state.organizations.set(clerkOrgId, {
        clerkOrgId,
        name: "Brand New Agency",
      });
      state.users.set(clerkUserId, {
        clerkUserId,
        email: "newcomer@northwind.test",
        name: "New Comer",
        imageUrl: undefined,
      });
      state.memberships.set(`${clerkOrgId}:${clerkUserId}`, "org:admin");

      const result = await deliver(fakeGateway(state), {
        type: "organizationMembership.created",
        data: {
          organization: { id: clerkOrgId },
          public_user_data: { user_id: clerkUserId },
          role: "org:admin",
        },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId));
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      expect(org?.name).toBe("Brand New Agency");
      expect(user?.email).toBe("newcomer@northwind.test");

      if (org !== undefined) createdOrgs.push(org.id);
      if (user !== undefined) createdUsers.push(user.id);

      const rows =
        org === undefined || user === undefined
          ? []
          : await membershipRows(org.id, user.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.role).toBe("admin");
    });

    it("refuses with org_deleted and writes nothing when the organization is soft deleted locally", async () => {
      const org = await makeOrganization({ deletedAt: new Date() });
      const user = await makeUser();
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: "Still Live In Clerk",
      });
      state.users.set(user.clerkUserId, {
        clerkUserId: user.clerkUserId,
        email: user.clerkUserId + "@northwind.test",
        name: undefined,
        imageUrl: undefined,
      });
      state.memberships.set(
        `${org.clerkOrgId}:${user.clerkUserId}`,
        "org:member",
      );

      const result = await deliver(fakeGateway(state), {
        type: "organizationMembership.created",
        data: {
          organization: { id: org.clerkOrgId },
          public_user_data: { user_id: user.clerkUserId },
          role: "org:member",
        },
      });

      expect(result).toMatchObject({
        status: 200,
        outcome: "refused",
        reason: "org_deleted",
      });
      expect(await membershipRows(org.id, user.id)).toHaveLength(0);
    });

    it("refuses with user_deleted and writes nothing when the user is scrubbed locally", async () => {
      const org = await makeOrganization();
      const user = await makeUser({ deletedAt: new Date() });
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: org.clerkOrgId,
      });
      state.users.set(user.clerkUserId, {
        clerkUserId: user.clerkUserId,
        email: "still-in-clerk@northwind.test",
        name: undefined,
        imageUrl: undefined,
      });
      state.memberships.set(
        `${org.clerkOrgId}:${user.clerkUserId}`,
        "org:member",
      );

      const result = await deliver(fakeGateway(state), {
        type: "organizationMembership.created",
        data: {
          organization: { id: org.clerkOrgId },
          public_user_data: { user_id: user.clerkUserId },
          role: "org:member",
        },
      });

      expect(result).toMatchObject({
        status: 200,
        outcome: "refused",
        reason: "user_deleted",
      });
      expect(await membershipRows(org.id, user.id)).toHaveLength(0);
    });
  });

  describe("organizationMembership.deleted (AC-11)", () => {
    it("hard deletes exactly that (org_id, user_id) row", async () => {
      const org = await makeOrganization();
      const user = await makeUser();

      await db.insert(memberships).values({
        id: newId(),
        orgId: org.id,
        userId: user.id,
        role: "member",
      });

      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: org.clerkOrgId,
      });
      state.users.set(user.clerkUserId, {
        clerkUserId: user.clerkUserId,
        email: "leaving@northwind.test",
        name: undefined,
        imageUrl: undefined,
      });
      // Absent from `state.memberships`: gone from Clerk.

      const result = await deliver(fakeGateway(state), {
        type: "organizationMembership.deleted",
        data: {
          organization: { id: org.clerkOrgId },
          public_user_data: { user_id: user.clerkUserId },
        },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect(await membershipRows(org.id, user.id)).toHaveLength(0);
    });

    it("is a no change for a delete of a row that never existed", async () => {
      const org = await makeOrganization();
      const user = await makeUser();
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: org.clerkOrgId,
      });
      state.users.set(user.clerkUserId, {
        clerkUserId: user.clerkUserId,
        email: "never-joined@northwind.test",
        name: undefined,
        imageUrl: undefined,
      });

      const result = await deliver(fakeGateway(state), {
        type: "organizationMembership.deleted",
        data: {
          organization: { id: org.clerkOrgId },
          public_user_data: { user_id: user.clerkUserId },
        },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect(await membershipRows(org.id, user.id)).toHaveLength(0);
    });
  });

  describe("a user deleted from Clerk, with a bound contact (AC-8, AC-9)", () => {
    it("scrubs the row, removes memberships and unbinds the contact", async () => {
      const org = await makeOrganization();
      const user = await makeUser();

      await db.insert(memberships).values({
        id: newId(),
        orgId: org.id,
        userId: user.id,
        role: "member",
      });

      const clientId = newId();
      await db.insert(clients).values({
        id: clientId,
        orgId: org.id,
        name: "A Client Company",
      });

      const contactId = newId();
      await db.insert(clientContacts).values({
        id: contactId,
        orgId: org.id,
        clientId,
        userId: user.id,
        email: "contact@example.test",
        name: "Contact Person",
        acceptedAt: new Date(),
      });

      const state = newGatewayState();
      // Gone from Clerk: absent from `state.users`.

      const result = await deliver(fakeGateway(state), {
        type: "user.deleted",
        data: { id: user.clerkUserId, deleted: true },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });

      const row = await userRow(user.id);
      expect(row?.deletedAt).not.toBeNull();
      expect(row?.email).toBe(`deleted+${user.id}@invalid`);
      expect(row?.name).toBe("Deleted user");

      expect(await membershipRows(org.id, user.id)).toHaveLength(0);

      const [contact] = await db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, contactId));

      expect(contact?.userId).toBeNull();
      expect(contact?.acceptedAt).toBeNull();
      // Every other column is untouched, so a re invitation of the same
      // address starts from what the agency already knew.
      expect(contact?.email).toBe("contact@example.test");
    });

    it("a stranger, gone or present, is ignored and no row is created", async () => {
      const clerkUserId = clerkId("user");

      const result = await deliver(fakeGateway(newGatewayState()), {
        type: "user.deleted",
        data: { id: clerkUserId, deleted: true },
      });

      expect(result).toMatchObject({ status: 200, outcome: "ignored" });

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      expect(rows).toHaveLength(0);
    });

    it("an already scrubbed row answers handled with no change", async () => {
      const user = await makeUser({ deletedAt: new Date() });

      const result = await deliver(fakeGateway(newGatewayState()), {
        type: "user.deleted",
        data: { id: user.clerkUserId, deleted: true },
      });

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
    });
  });

  describe("an organization deleted from Clerk (AC-6)", () => {
    it("soft deletes the row, removes its memberships, and logs the subscription status itself", async () => {
      const org = await makeOrganization();
      const user = await makeUser();

      await db.insert(memberships).values({
        id: newId(),
        orgId: org.id,
        userId: user.id,
        role: "admin",
      });

      await db.insert(subscriptions).values({
        id: newId(),
        orgId: org.id,
        stripeCustomerId: `cus_${org.id}`,
        status: "active",
      });

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const result = await deliver(fakeGateway(newGatewayState()), {
          type: "organization.deleted",
          data: { id: org.clerkOrgId, deleted: true },
        });

        expect(result).toMatchObject({
          status: 200,
          outcome: "handled",
          reason: "organization_deleted",
        });

        const row = await organizationRow(org.id);
        expect(row?.deletedAt).not.toBeNull();
        expect(await membershipRows(org.id)).toHaveLength(0);

        // The delete branch logs itself (AC-6, AC-14): the dispatcher only
        // logs a non "handled" outcome, and this one is handled.
        const logged = warn.mock.calls
          .map(([line]) => String(line))
          .find((line) => line.includes(org.clerkOrgId));

        expect(logged).toContain('"outcome":"handled"');
        expect(logged).toContain("subscription_status=active");
      } finally {
        warn.mockRestore();
      }
    });

    it("is idempotent: a second delivery changes nothing, including the clock", async () => {
      const org = await makeOrganization();

      await deliver(fakeGateway(newGatewayState()), {
        type: "organization.deleted",
        data: { id: org.clerkOrgId, deleted: true },
      });

      const first = await organizationRow(org.id);

      const second = await deliver(fakeGateway(newGatewayState()), {
        type: "organization.deleted",
        data: { id: org.clerkOrgId, deleted: true },
      });

      expect(second).toMatchObject({ status: 200, outcome: "handled" });
      expect((await organizationRow(org.id))?.deletedAt).toEqual(
        first?.deletedAt,
      );
    });

    it("a stranger organization is ignored", async () => {
      const result = await deliver(fakeGateway(newGatewayState()), {
        type: "organization.deleted",
        data: { id: clerkId("org"), deleted: true },
      });

      expect(result).toMatchObject({ status: 200, outcome: "ignored" });
    });
  });

  describe("a database error while applying (AC-13)", () => {
    it("rolls back the whole transaction, so no ledger row survives and the redelivery is processed", async () => {
      const org = await makeOrganization();
      const state = newGatewayState();
      state.organizations.set(org.clerkOrgId, {
        clerkOrgId: org.clerkOrgId,
        name: "Should Never Land",
      });
      const svixId = `msg_${randomUUID()}`;

      const failingHandle = dbThatFailsWriting(db, organizations);

      const failed = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: org.clerkOrgId } },
        { id: svixId, handle: failingHandle },
      );

      expect(failed).toMatchObject({ status: 500, outcome: "failed" });
      expect(await ledgerCount(svixId)).toBe(0);
      expect((await organizationRow(org.id))?.name).not.toBe(
        "Should Never Land",
      );

      // The redelivery, against the real handle, is processed rather than
      // skipped as a duplicate: nothing was ever committed to skip.
      const retried = await deliver(
        fakeGateway(state),
        { type: "organization.updated", data: { id: org.clerkOrgId } },
        { id: svixId },
      );

      expect(retried).toMatchObject({ status: 200, outcome: "handled" });
      expect((await organizationRow(org.id))?.name).toBe("Should Never Land");
    });
  });

  describe("two deliveries at once (AC-12)", () => {
    it("serialises on the organization row: both commit, one row, no deadlock", async () => {
      const clerkOrgId = clerkId("org");
      const clerkUserId = clerkId("user");
      const stateA = newGatewayState();
      const stateB = newGatewayState();

      for (const [state, role] of [
        [stateA, "org:admin"],
        [stateB, "org:member"],
      ] as const) {
        state.organizations.set(clerkOrgId, {
          clerkOrgId,
          name: "Racing Agency",
        });
        state.users.set(clerkUserId, {
          clerkUserId,
          email: "racer@northwind.test",
          name: undefined,
          imageUrl: undefined,
        });
        state.memberships.set(`${clerkOrgId}:${clerkUserId}`, role);
      }

      const [first, second] = await Promise.all([
        deliver(fakeGateway(stateA), {
          type: "organizationMembership.created",
          data: {
            organization: { id: clerkOrgId },
            public_user_data: { user_id: clerkUserId },
            role: "org:admin",
          },
        }),
        deliver(fakeGateway(stateB), {
          type: "organizationMembership.created",
          data: {
            organization: { id: clerkOrgId },
            public_user_data: { user_id: clerkUserId },
            role: "org:member",
          },
        }),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId));
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.clerkUserId, clerkUserId));

      expect(org).toBeDefined();
      expect(user).toBeDefined();

      if (org !== undefined) createdOrgs.push(org.id);
      if (user !== undefined) createdUsers.push(user.id);

      const rows =
        org === undefined || user === undefined
          ? []
          : await membershipRows(org.id, user.id);

      expect(rows).toHaveLength(1);
      expect(["admin", "member"]).toContain(rows[0]?.role);
    });
  });
});
