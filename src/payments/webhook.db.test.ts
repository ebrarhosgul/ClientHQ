/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-3, AC-4, AC-8, AC-9, AC-10, AC-11, AC-12, AC-15, AC-16,
 * AC-22, AC-23, AC-25, AC-26, AC-27
 *
 * The webhook against real SQL, because every claim it makes is a claim about
 * the database. Replay, ordering, the row lock, the rollback and the
 * `past_due_since` clock are all things a mock would agree with and PostgreSQL
 * might not, and disagreeing is the entire point of testing them.
 *
 * Stripe itself is faked. That half is deliberate: the ordering and the
 * transaction are this app's, the network is not, and a suite that needed a
 * Stripe account would be a suite nobody runs.
 *
 * Each case makes its own organization and deletes it afterwards, so this can
 * be pointed at a development project as safely as at CI's container. Rolling
 * one outer transaction back would not do here: the concurrency case needs two
 * genuinely separate connections, which savepoints cannot give it.
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  organizations,
  processedWebhookEvents,
  subscriptions,
} from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import {
  handleStripeWebhook,
  type StripeGateway,
  type VerifiedEvent,
} from "./webhook";

loadEnvFiles();

const url = process.env.DIRECT_URL;

// More than one connection on purpose: the concurrency case needs two
// deliveries genuinely in flight at once for the row lock to mean anything.
const sql = postgres(url ?? "", { prepare: false, max: 4 });
const db: Database = drizzle(sql, { schema });

/** Everything this file created, torn down after each case. */
const createdOrgs: string[] = [];
const createdEvents: string[] = [];

async function makeOrganization(
  patch: { readonly deletedAt?: Date } = {},
): Promise<string> {
  const id = newId();
  const tag = id.slice(0, 8);

  await db.insert(organizations).values({
    id,
    clerkOrgId: `org_${tag}`,
    name: `Agency ${tag}`,
    slug: `agency-${tag}`,
    deletedAt: patch.deletedAt,
  });

  createdOrgs.push(id);

  return id;
}

function eventId(): string {
  const id = `evt_${newId().replace(/-/g, "")}`;
  createdEvents.push(id);

  return id;
}

/** A Stripe subscription as `subscriptions.retrieve` would return it. */
function retrieved(patch: Record<string, unknown> = {}) {
  return {
    id: "sub_default",
    customer: "cus_default",
    status: "trialing",
    cancel_at_period_end: false,
    // Only the nightly reconcile reads this (spec 0017, AC-7); the webhook
    // never does, so a fixed value is fine for every case in this file.
    created: 1700000000,
    metadata: {},
    items: {
      data: [
        {
          current_period_end: 1790000000,
          price: { id: "price_default" },
        },
      ],
    },
    ...patch,
  };
}

function checkoutEvent(orgId: string, id = eventId()): VerifiedEvent {
  return {
    id,
    type: "checkout.session.completed",
    object: {
      client_reference_id: orgId,
      customer: "cus_default",
      subscription: "sub_default",
    },
  };
}

function subscriptionUpdated(id = eventId()): VerifiedEvent {
  return {
    id,
    type: "customer.subscription.updated",
    // Deliberately stale and deliberately wrong: nothing here is ever written.
    object: { id: "sub_default", status: "canceled" },
  };
}

function gatewayReturning(
  event: VerifiedEvent | undefined,
  subscription: unknown,
): StripeGateway {
  return {
    constructEvent: async (): Promise<VerifiedEvent> => {
      if (event === undefined) {
        throw new Error("No signatures found matching the expected signature");
      }

      return event;
    },
    retrieveSubscription: async (): Promise<unknown> => subscription,
  };
}

type DeliveryOptions = {
  readonly handle?: Database;
  /** Deliver with no `stripe-signature` header at all. */
  readonly withoutSignature?: boolean;
};

function deliver(gateway: StripeGateway, options: DeliveryOptions = {}) {
  return handleStripeWebhook({
    db: options.handle ?? db,
    gateway,
    body: "{}",
    signature:
      options.withoutSignature === true ? undefined : "t=1,v1=whatever",
  });
}

async function rowFor(orgId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  return row;
}

async function ledgerCount(id: string): Promise<number> {
  const rows = await db
    .select({ id: processedWebhookEvents.id })
    .from(processedWebhookEvents)
    .where(
      and(
        eq(processedWebhookEvents.source, "stripe"),
        eq(processedWebhookEvents.eventId, id),
      ),
    );

  return rows.length;
}

/**
 * A handle whose subscription write throws, so the state change fails after the
 * ledger row has already been inserted. That is the only interesting shape of
 * failure here: it is the one where committing the ledger separately would mark
 * an event handled while losing its effect.
 */
function dbThatFailsApplying(real: Database): Database {
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
                  if (txProperty !== "insert") {
                    return Reflect.get(txTarget, txProperty, txReceiver);
                  }

                  return (table: unknown) => {
                    if (table === subscriptions) {
                      throw new Error("connection reset applying state");
                    }

                    return txTarget.insert(table as typeof organizations);
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
    // `subscriptions.org_id` cascades, so the mirror row goes with it.
    await db
      .delete(organizations)
      .where(inArray(organizations.id, createdOrgs));
    createdOrgs.length = 0;
  }
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("the Stripe webhook against real PostgreSQL", () => {
  describe("the happy path", () => {
    it("writes one row from what Stripe reports, not from what arrived", async () => {
      const orgId = await makeOrganization();

      const result = await deliver(
        gatewayReturning(
          checkoutEvent(orgId),
          retrieved({
            id: "sub_live",
            customer: "cus_live",
            status: "trialing",
            items: {
              data: [
                {
                  current_period_end: 1790000000,
                  price: { id: "price_live" },
                },
              ],
            },
          }),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "handled" });

      const row = await rowFor(orgId);

      expect(row).toMatchObject({
        stripeCustomerId: "cus_live",
        stripeSubscriptionId: "sub_live",
        stripePriceId: "price_live",
        status: "trialing",
        cancelAtPeriodEnd: false,
        pastDueSince: null,
      });
      // Item level, and a real timestamp rather than the silent null a pre
      // Basil read would have stored.
      expect(row?.currentPeriodEnd).toEqual(new Date(1790000000 * 1000));
    });

    it("ignores an event the endpoint is not subscribed to", async () => {
      const result = await deliver(
        gatewayReturning(
          { id: eventId(), type: "customer.created", object: {} },
          retrieved(),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "ignored" });
    });
  });

  describe("the same event twice", () => {
    it("changes nothing the second time and still answers 200", async () => {
      const orgId = await makeOrganization();
      const event = checkoutEvent(orgId);

      await deliver(gatewayReturning(event, retrieved()));
      const first = await rowFor(orgId);

      const second = await deliver(
        gatewayReturning(
          event,
          // A different state, to prove the second delivery applies nothing.
          retrieved({ status: "active", customer: "cus_default" }),
        ),
      );

      expect(second).toMatchObject({ status: 200, outcome: "duplicate" });
      expect(await ledgerCount(event.id)).toBe(1);
      expect(await rowFor(orgId)).toEqual(first);
    });

    it("commits cleanly, so a later event in the same run still applies", async () => {
      // AC-23: the duplicate path must not poison the transaction it protects.
      // Catching a raised unique violation instead of conflict-do-nothing would
      // leave the transaction aborted and this next write would fail.
      const orgId = await makeOrganization();
      const event = checkoutEvent(orgId);

      await deliver(gatewayReturning(event, retrieved()));
      await deliver(gatewayReturning(event, retrieved()));

      const next = await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ status: "active", customer: "cus_default" }),
        ),
      );

      expect(next).toMatchObject({ status: 200, outcome: "handled" });
      expect((await rowFor(orgId))?.status).toBe("active");
    });
  });

  describe("events out of order", () => {
    it("leaves the row holding what Stripe currently reports, not the older payload", async () => {
      const orgId = await makeOrganization();

      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));

      // The payload says `canceled`. Stripe, asked directly, says `active`.
      // The payload is a signal that something changed, never the change.
      const result = await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ status: "active", stripePriceId: undefined }),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect((await rowFor(orgId))?.status).toBe("active");
    });

    it("resolves an invoice event through the subscription its parent names", async () => {
      const orgId = await makeOrganization();

      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));

      const result = await deliver(
        gatewayReturning(
          {
            id: eventId(),
            type: "invoice.payment_failed",
            object: {
              parent: {
                type: "subscription_details",
                subscription_details: { subscription: "sub_default" },
              },
            },
          },
          retrieved({ status: "past_due" }),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect((await rowFor(orgId))?.status).toBe("past_due");
    });
  });

  describe("when applying the state change fails", () => {
    it("rolls the ledger row back with it, answers 500, and lets the redelivery through", async () => {
      const orgId = await makeOrganization();
      const event = checkoutEvent(orgId);

      const failed = await deliver(gatewayReturning(event, retrieved()), {
        handle: dbThatFailsApplying(db),
      });

      expect(failed).toMatchObject({ status: 500, outcome: "failed" });
      // Nothing half applied survived, ledger row included. Had the ledger
      // committed on its own, Stripe's retry below would be a silent no op.
      expect(await ledgerCount(event.id)).toBe(0);
      expect(await rowFor(orgId)).toBeUndefined();

      const retried = await deliver(gatewayReturning(event, retrieved()));

      expect(retried).toMatchObject({ status: 200, outcome: "handled" });
      expect(await rowFor(orgId)).toBeDefined();
    });
  });

  describe("a signature that does not verify", () => {
    it("answers 400 and writes nothing at all", async () => {
      const orgId = await makeOrganization();
      const id = eventId();

      const result = await deliver(gatewayReturning(undefined, retrieved()));

      expect(result).toMatchObject({ status: 400, outcome: "unverified" });
      expect(await ledgerCount(id)).toBe(0);
      expect(await rowFor(orgId)).toBeUndefined();
    });

    it("answers 400 when there is no signature header at all", async () => {
      const result = await deliver(
        gatewayReturning(checkoutEvent(await makeOrganization()), retrieved()),
        { withoutSignature: true },
      );

      expect(result).toMatchObject({ status: 400, outcome: "unverified" });
    });
  });

  describe("past_due_since", () => {
    it("is set once, left alone while it lasts, and cleared on the way out", async () => {
      const orgId = await makeOrganization();

      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));
      expect((await rowFor(orgId))?.pastDueSince).toBeNull();

      await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ status: "past_due" }),
        ),
      );
      const first = (await rowFor(orgId))?.pastDueSince;

      expect(first).toBeInstanceOf(Date);

      // A second `past_due` must not extend the window feature 9 measures.
      await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ status: "past_due" }),
        ),
      );

      expect((await rowFor(orgId))?.pastDueSince).toEqual(first);

      await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ status: "active" }),
        ),
      );

      expect((await rowFor(orgId))?.pastDueSince).toBeNull();
    });
  });

  describe("an event that can never succeed", () => {
    it("answers 200 for a subscription naming no agency, rather than looping on 500", async () => {
      const result = await deliver(
        gatewayReturning(subscriptionUpdated(), retrieved({ metadata: {} })),
      );

      expect(result).toMatchObject({
        status: 200,
        outcome: "refused",
        reason: "no_org_id",
      });
    });

    it("answers 200 for an org_id naming an organization that does not exist", async () => {
      const result = await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ metadata: { org_id: newId() } }),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "refused" });
    });

    it("answers 200 for an org_id that is not a uuid, rather than letting PostgreSQL raise", async () => {
      const result = await deliver(
        gatewayReturning(
          subscriptionUpdated(),
          retrieved({ metadata: { org_id: "not-a-uuid" } }),
        ),
      );

      expect(result).toMatchObject({ status: 200, outcome: "refused" });
    });

    it("answers 200 for an invoice with no subscription behind it", async () => {
      const result = await deliver(
        gatewayReturning(
          {
            id: eventId(),
            type: "invoice.payment_succeeded",
            object: { parent: null },
          },
          retrieved(),
        ),
      );

      expect(result).toMatchObject({
        status: 200,
        outcome: "refused",
        reason: "no_subscription_reference",
      });
    });
  });

  describe("the holes around a second Stripe customer", () => {
    it("updates the existing row rather than failing on the unique org_id", async () => {
      const orgId = await makeOrganization();

      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));

      const again = await deliver(
        gatewayReturning(
          checkoutEvent(orgId),
          retrieved({ status: "active", customer: "cus_default" }),
        ),
      );

      expect(again).toMatchObject({ status: 200, outcome: "handled" });
      expect((await rowFor(orgId))?.status).toBe("active");
    });

    it("refuses to replace a stored customer id with a different one", async () => {
      const orgId = await makeOrganization();
      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));

      const event = checkoutEvent(orgId);

      const result = await deliver(
        gatewayReturning(event, retrieved({ customer: "cus_someone_else" })),
      );

      expect(result).toMatchObject({
        status: 200,
        outcome: "refused",
        reason: "customer_id_conflict",
      });
      // Refused *and* rolled back: the paying customer is untouched.
      expect((await rowFor(orgId))?.stripeCustomerId).toBe("cus_default");
      expect(await ledgerCount(event.id)).toBe(0);
    });

    it("lands a subscription event that outran its Checkout Session", async () => {
      // AC-22: `customer.subscription.created` arrives first, with no row to
      // find. The org_id `startCheckout` wrote into the subscription metadata
      // is what saves it.
      const orgId = await makeOrganization();

      const created = await deliver(
        gatewayReturning(
          {
            id: eventId(),
            type: "customer.subscription.created",
            object: { id: "sub_default" },
          },
          retrieved({ metadata: { org_id: orgId } }),
        ),
      );

      expect(created).toMatchObject({ status: 200, outcome: "handled" });
      expect(await rowFor(orgId)).toBeDefined();

      // The session event then updates that row rather than duplicating it.
      const session = await deliver(
        gatewayReturning(
          checkoutEvent(orgId),
          retrieved({ status: "active", metadata: { org_id: orgId } }),
        ),
      );

      expect(session).toMatchObject({ status: 200, outcome: "handled" });

      const rows = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.orgId, orgId));

      expect(rows).toHaveLength(1);
    });
  });

  describe("an organization that has been soft deleted", () => {
    it("still gets its mirror row written", async () => {
      // Stripe is still billing whoever this is. A row that stops updating is
      // worse than a row about a closed account.
      const orgId = await makeOrganization({ deletedAt: new Date() });

      const result = await deliver(
        gatewayReturning(checkoutEvent(orgId), retrieved()),
      );

      expect(result).toMatchObject({ status: 200, outcome: "handled" });
      expect(await rowFor(orgId)).toBeDefined();
    });
  });

  describe("two deliveries at once", () => {
    it("commits one whole state or the other, never a mix of both", async () => {
      const orgId = await makeOrganization();
      await deliver(gatewayReturning(checkoutEvent(orgId), retrieved()));

      // Two states that differ in every mirrored field, so a row holding half
      // of each is unmistakable.
      const active = retrieved({
        status: "active",
        items: {
          data: [
            { current_period_end: 1800000000, price: { id: "price_active" } },
          ],
        },
      });
      const pastDue = retrieved({
        status: "past_due",
        items: {
          data: [
            { current_period_end: 1810000000, price: { id: "price_past_due" } },
          ],
        },
      });

      const [first, second] = await Promise.all([
        deliver(gatewayReturning(subscriptionUpdated(), active)),
        deliver(gatewayReturning(subscriptionUpdated(), pastDue)),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const row = await rowFor(orgId);

      const landed =
        row?.status === "active"
          ? { price: "price_active", end: 1800000000 }
          : { price: "price_past_due", end: 1810000000 };

      expect(row?.stripePriceId).toBe(landed.price);
      expect(row?.currentPeriodEnd).toEqual(new Date(landed.end * 1000));
    });
  });
});
