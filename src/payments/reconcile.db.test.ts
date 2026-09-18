/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-7
 *
 * The Stripe reconcile against real PostgreSQL, with Stripe itself faked
 * through the same `StripeListGateway` interface `liveStripeListGateway()`
 * implements: the complete listing rule, the resolve, the newest per agency
 * rule, the apply through the shared `applySubscriptionState`, and the
 * `unresolved`, `customer_conflict`, `superseded` and `unlisted` counts.
 *
 * Each case makes its own organization and deletes it afterwards, so this can
 * be pointed at a development project as safely as at CI's container.
 * Skipped when `DIRECT_URL` is not set, like the other database suites.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { organizations, subscriptions } from "@/db/schema";
import type { Database } from "@/db/tenant";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

import type { RetrievedSubscription } from "./events";
import { stripeReconcileSweep, type StripeListGateway } from "./reconcile";

loadEnvFiles();

const url = process.env.DIRECT_URL;
const sql = postgres(url ?? "", { prepare: false, max: 2 });
const db: Database = drizzle(sql, { schema });

const createdOrgs: string[] = [];

/**
 * Drawn from `randomUUID()` rather than `newId()`'s time ordered bits: this
 * suite runs concurrently with every other `*.db.test.ts` file against one
 * shared database, and a millisecond timestamp prefix collides across files
 * under that load in a way a fully random one does not.
 */
function tag(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

async function makeOrg(): Promise<string> {
  const id = newId();
  const unique = tag();

  await db.insert(organizations).values({
    id,
    clerkOrgId: `org_${unique}`,
    name: `Agency ${unique}`,
    slug: `agency-${unique}`,
  });

  createdOrgs.push(id);

  return id;
}

async function makeSubscriptionRow(patch: {
  readonly orgId: string;
  readonly stripeCustomerId: string;
  readonly stripeSubscriptionId?: string;
  readonly status?: string;
}): Promise<void> {
  await db.insert(subscriptions).values({
    id: newId(),
    orgId: patch.orgId,
    stripeCustomerId: patch.stripeCustomerId,
    stripeSubscriptionId: patch.stripeSubscriptionId,
    status: patch.status ?? "trialing",
  });
}

async function rowFor(orgId: string) {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId));

  return row;
}

/**
 * Every local `subscriptions` row with a Stripe subscription id, agency
 * unscoped: `unlisted` is a system wide count, so a test that asserts it
 * exactly has to know the ambient total first rather than assume the shared
 * database holds only what this file wrote.
 */
async function countLocalSubscriptionRows(): Promise<number> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(isNotNull(subscriptions.stripeSubscriptionId));

  return rows.length;
}

/** A parsed `RetrievedSubscription`, the shape `listSubscriptions` yields. */
function subscription(
  patch: Partial<RetrievedSubscription> & {
    readonly id: string;
    readonly customer: string;
  },
): RetrievedSubscription {
  return {
    status: "active",
    cancel_at_period_end: false,
    created: new Date("2026-01-01T00:00:00Z"),
    metadata: {},
    items: {
      data: [
        {
          current_period_end: new Date("2027-01-01T00:00:00Z"),
          price: { id: "price_default" },
        },
      ],
    },
    ...patch,
  };
}

function fakeGateway(
  listed: readonly RetrievedSubscription[],
  options: { readonly throwAfter?: number } = {},
): StripeListGateway {
  return {
    listSubscriptions: async function* listSubscriptions() {
      for (const [index, item] of listed.entries()) {
        if (options.throwAfter === index) {
          throw new Error("stripe list failed on page two");
        }

        yield item;
      }
    },
  };
}

const NOW = new Date("2026-06-15T03:00:00Z");

function run(gateway: StripeListGateway) {
  return stripeReconcileSweep(gateway).run({
    db,
    todayUtc: "2026-06-15",
    now: NOW,
  });
}

afterEach(async () => {
  if (createdOrgs.length === 0) {
    return;
  }

  await db
    .delete(subscriptions)
    .where(inArray(subscriptions.orgId, createdOrgs));
  await db.delete(organizations).where(inArray(organizations.id, createdOrgs));

  createdOrgs.length = 0;
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("stripe_reconcile against real PostgreSQL", () => {
  it("updates an existing row to what Stripe currently reports", async () => {
    const orgId = await makeOrg();
    await makeSubscriptionRow({
      orgId,
      stripeCustomerId: "cus_stale",
      stripeSubscriptionId: "sub_old",
      status: "trialing",
    });

    const periodEnd = new Date("2027-03-01T00:00:00Z");
    const report = await run(
      fakeGateway([
        subscription({
          id: "sub_new",
          customer: "cus_stale",
          status: "active",
          cancel_at_period_end: true,
          items: {
            data: [
              { current_period_end: periodEnd, price: { id: "price_new" } },
            ],
          },
        }),
      ]),
    );

    expect(report.outcome).toBe("ok");
    // `unlisted` is a system wide count (every local `subscriptions` row
    // against this one fake listing), so it is not asserted here: a shared
    // development database carries other agencies' rows too. The dedicated
    // "counts a local row absent" case below proves that count precisely,
    // by baselining it first.
    expect(report.counts).toMatchObject({
      listed: 1,
      applied: 1,
      unresolved: 0,
      customer_conflict: 0,
      superseded: 0,
      errors: 0,
    });

    const row = await rowFor(orgId);
    expect(row).toMatchObject({
      stripeCustomerId: "cus_stale",
      stripeSubscriptionId: "sub_new",
      stripePriceId: "price_new",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEnd,
    });
  });

  it("creates a row for a subscription with no local row, resolved by metadata org_id", async () => {
    const orgId = await makeOrg();

    const report = await run(
      fakeGateway([
        subscription({
          id: "sub_fresh",
          customer: "cus_fresh",
          metadata: { org_id: orgId },
        }),
      ]),
    );

    expect(report.counts).toMatchObject({ applied: 1, unresolved: 0 });

    const row = await rowFor(orgId);
    expect(row).toMatchObject({
      orgId,
      stripeCustomerId: "cus_fresh",
      stripeSubscriptionId: "sub_fresh",
    });
  });

  it("counts a subscription naming no agency as unresolved, and creates nothing", async () => {
    const report = await run(
      fakeGateway([subscription({ id: "sub_orphan", customer: "cus_orphan" })]),
    );

    expect(report.outcome).toBe("ok");
    expect(report.counts).toMatchObject({
      listed: 1,
      applied: 0,
      unresolved: 1,
    });
  });

  it("counts a local row absent from the listing as unlisted, and leaves it unchanged", async () => {
    const baseline = await countLocalSubscriptionRows();

    const orgId = await makeOrg();
    await makeSubscriptionRow({
      orgId,
      stripeCustomerId: "cus_gone",
      stripeSubscriptionId: "sub_gone",
      status: "active",
    });

    // An empty listing means every local row with a subscription id,
    // baseline plus the one just added, is absent from it.
    const report = await run(fakeGateway([]));

    expect(report.counts).toMatchObject({
      listed: 0,
      applied: 0,
      unresolved: 0,
      customer_conflict: 0,
      superseded: 0,
      errors: 0,
    });
    expect(report.counts?.unlisted).toBe(baseline + 1);

    const row = await rowFor(orgId);
    expect(row).toMatchObject({
      stripeSubscriptionId: "sub_gone",
      status: "active",
    });
  });

  it.each([
    ["listed oldest first", false],
    ["listed newest first", true],
  ])(
    "keeps the newest of two subscriptions resolving to one agency, %s",
    async (_label, reversed) => {
      const orgId = await makeOrg();

      const older = subscription({
        id: "sub_old_e",
        customer: "cus_old_e",
        status: "canceled",
        created: new Date("2025-01-01T00:00:00Z"),
        metadata: { org_id: orgId },
      });
      const newer = subscription({
        id: "sub_new_e",
        customer: "cus_new_e",
        status: "active",
        created: new Date("2026-01-01T00:00:00Z"),
        metadata: { org_id: orgId },
      });

      const report = await run(
        fakeGateway(reversed ? [newer, older] : [older, newer]),
      );

      expect(report.counts).toMatchObject({
        listed: 2,
        applied: 1,
        superseded: 1,
      });

      const row = await rowFor(orgId);
      expect(row).toMatchObject({
        stripeCustomerId: "cus_new_e",
        stripeSubscriptionId: "sub_new_e",
        status: "active",
      });
    },
  );

  it("counts a customer id change as customer_conflict, and leaves the row unchanged", async () => {
    const orgId = await makeOrg();
    await makeSubscriptionRow({
      orgId,
      stripeCustomerId: "cus_original",
      stripeSubscriptionId: "sub_original",
      status: "active",
    });

    const report = await run(
      fakeGateway([
        subscription({
          id: "sub_conflict",
          customer: "cus_different",
          metadata: { org_id: orgId },
        }),
      ]),
    );

    expect(report.outcome).toBe("ok");
    expect(report.counts).toMatchObject({
      applied: 0,
      customer_conflict: 1,
    });

    const row = await rowFor(orgId);
    expect(row).toMatchObject({
      stripeCustomerId: "cus_original",
      stripeSubscriptionId: "sub_original",
    });
  });

  it("writes nothing and produces no unlisted count when the listing fails partway", async () => {
    const orgId = await makeOrg();
    await makeSubscriptionRow({
      orgId,
      stripeCustomerId: "cus_untouched",
      stripeSubscriptionId: "sub_untouched",
      status: "active",
    });

    await expect(
      run(
        fakeGateway(
          [
            subscription({ id: "sub_page_one", customer: "cus_page_one" }),
            subscription({ id: "sub_page_two", customer: "cus_page_two" }),
          ],
          { throwAfter: 1 },
        ),
      ),
    ).rejects.toThrow("stripe list failed on page two");

    const row = await rowFor(orgId);
    expect(row).toMatchObject({
      stripeCustomerId: "cus_untouched",
      stripeSubscriptionId: "sub_untouched",
    });
  });
});
