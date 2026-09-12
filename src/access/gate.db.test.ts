/**
 * @vitest-environment node
 *
 * covers: spec 0008 AC-1, AC-2, AC-3, AC-4, AC-8, AC-9
 *
 * The gate against real PostgreSQL: both readers, `agencyAccess()` for the
 * layout and `requireFullAccess()` for the wrapper, run their real SQL through
 * the scoped accessor against a seeded row, and the suite proves the two things
 * a stub cannot. That the read is tenant scoped (an agency with no row is
 * unsubscribed even while another agency's row says active), and that nothing
 * about the row changes for any level, because every statement the gate emits
 * is a `select`.
 *
 * Every case runs inside a transaction that is rolled back, so the suite leaves
 * the database as it found it. The pooled executor the gate reaches for is
 * pointed at that transaction, which is the one seam in the tenant layer built
 * for exactly this (spec 0003, AC-14).
 *
 * Skipped when `DIRECT_URL` is not set, so `pnpm test` still runs without a
 * database. CI sets it and runs this file against the container it just
 * migrated.
 */
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import { organizations, subscriptions, users, memberships } from "@/db/schema";
import type { StaffContext, TransactionExecutor } from "@/db/tenant";
import { isTenantActionError } from "@/db/tenant/errors";
import { newId } from "@/lib/id";
import { loadEnvFiles } from "@/lib/load-env-files";

const state = vi.hoisted(() => ({
  tx: undefined as unknown,
  ctx: undefined as unknown,
}));

// The gate reads on the pooled executor. Here that is the open transaction, so
// the real statements run and are rolled back with everything else.
vi.mock("@/db/tenant/executor", () => ({
  pooledDb: async () => state.tx,
}));

vi.mock("@/auth/context", () => ({
  agencyContext: async () => state.ctx,
}));

const { agencyAccess } = await import("./gate");
const { requireFullAccess } = await import("@/db/tenant/subscription");

loadEnvFiles();

const url = process.env.DIRECT_URL;

/** Every statement emitted during one case, lower cased. */
const emitted: string[] = [];

const sql = postgres(url ?? "", { prepare: false, max: 1 });
const db = drizzle(sql, {
  schema,
  logger: {
    logQuery(query) {
      emitted.push(query.toLowerCase());
    },
  },
});

const DAY = 24 * 60 * 60 * 1000;

type Fixture = {
  readonly ctx: StaffContext;
  readonly subscriptionId: string | undefined;
  /** This case's two agencies; the snapshot below looks at nothing else. */
  readonly orgIds: readonly string[];
};

type SeedRow = {
  readonly status: string;
  readonly pastDueSince: Date | null;
};

/**
 * One agency with one staff member, and optionally one subscription row, plus a
 * second agency that always has an `active` row: the one a scoping bug would
 * hand to the first.
 */
async function seed(
  tx: TransactionExecutor,
  row: SeedRow | undefined,
): Promise<Fixture> {
  const orgId = newId();
  const otherOrgId = newId();
  const userId = newId();
  // The whole id, not a prefix: a time ordered id shares its first characters
  // with every other id minted in the same millisecond, here and in the other
  // database suites running beside this one.
  const tag = orgId;

  await tx.insert(organizations).values([
    { id: orgId, clerkOrgId: `org_${tag}`, name: "Gated", slug: `g-${tag}` },
    {
      id: otherOrgId,
      clerkOrgId: `org_${tag}_o`,
      name: "Other",
      slug: `o-${tag}`,
    },
  ]);

  await tx.insert(users).values({
    id: userId,
    clerkUserId: `user_${tag}`,
    email: `staff-${tag}@example.test`,
    name: "Staff",
  });

  await tx.insert(memberships).values({
    id: newId(),
    orgId,
    userId,
    role: "admin",
  });

  const subscriptionId = row === undefined ? undefined : newId();

  await tx.insert(subscriptions).values([
    {
      id: newId(),
      orgId: otherOrgId,
      stripeCustomerId: `cus_${tag}_o`,
      status: "active",
    },
    ...(row === undefined || subscriptionId === undefined
      ? []
      : [
          {
            id: subscriptionId,
            orgId,
            stripeCustomerId: `cus_${tag}`,
            status: row.status,
            pastDueSince: row.pastDueSince,
          },
        ]),
  ]);

  return {
    ctx: {
      kind: "staff",
      orgId,
      clerkOrgId: `org_${tag}`,
      userId,
      clerkUserId: `user_${tag}`,
      role: "admin",
    },
    subscriptionId,
    orgIds: [orgId, otherOrgId],
  };
}

/**
 * Everything about this case's rows that a write would touch. Scoped to the
 * case's own agencies, because the other database suites run beside this one
 * against the same database and add rows of their own.
 */
async function snapshot(
  tx: TransactionExecutor,
  fixture: Fixture,
): Promise<unknown> {
  const rows = await tx
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.orgId, [...fixture.orgIds]));
  const own =
    fixture.subscriptionId === undefined
      ? undefined
      : rows.find((r) => r.id === fixture.subscriptionId);

  return { count: rows.length, own };
}

async function inRolledBackTransaction(
  row: SeedRow | undefined,
  run: (tx: TransactionExecutor, fixture: Fixture) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback");

  try {
    await db.transaction(async (tx) => {
      state.tx = tx;
      const fixture = await seed(tx, row);
      state.ctx = fixture.ctx;
      const before = await snapshot(tx, fixture);

      emitted.length = 0;
      await run(tx, fixture);
      const gateStatements = [...emitted];

      // AC-8: every statement the gate ran was a read, and the row is as it was.
      expect(gateStatements.length).toBeGreaterThan(0);
      for (const statement of gateStatements) {
        expect(statement.trimStart()).toMatch(/^select\b/);
      }
      expect(await snapshot(tx, fixture)).toStrictEqual(before);

      throw rollback;
    });
  } catch (thrown) {
    if (thrown !== rollback) {
      throw thrown;
    }
  }
}

async function refusalCode(ctx: StaffContext): Promise<string | undefined> {
  try {
    await requireFullAccess(ctx, "createClient");
  } catch (thrown) {
    return isTenantActionError(thrown) ? thrown.error.code : "unexpected";
  }

  return undefined;
}

const warned: string[] = [];

beforeEach(() => {
  warned.length = 0;
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await sql.end();
});

describe.skipIf(!url)("the access gate against real PostgreSQL", () => {
  it("is full on an active row, and the write goes through", async () => {
    await inRolledBackTransaction(
      { status: "active", pastDueSince: null },
      async (_tx, { ctx }) => {
        expect(await agencyAccess()).toStrictEqual({
          level: "full",
          role: "admin",
        });
        expect(await refusalCode(ctx)).toBeUndefined();
        expect(warned).toHaveLength(0);
      },
    );
  });

  it("is unsubscribed with no row of its own, even while another agency's row says active (AC-9)", async () => {
    await inRolledBackTransaction(undefined, async (_tx, { ctx }) => {
      expect((await agencyAccess()).level).toBe("unsubscribed");
      expect(await refusalCode(ctx)).toBe("subscription_inactive");
    });
  });

  it("is grace an hour into a failed payment: reads allowed, the write refused (AC-2)", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    await inRolledBackTransaction(
      { status: "past_due", pastDueSince: since },
      async (_tx, { ctx }) => {
        const access = await agencyAccess();

        expect(access.level).toBe("grace");
        expect(access.graceEndsAt?.getTime()).toBe(since.getTime() + 7 * DAY);
        expect(await refusalCode(ctx)).toBe("subscription_inactive");
      },
    );
  });

  it("is locked 7 days and one second in, with no job having run (AC-2, AC-4)", async () => {
    const since = new Date(Date.now() - 7 * DAY - 1000);

    await inRolledBackTransaction(
      { status: "past_due", pastDueSince: since },
      async (_tx, { ctx }) => {
        expect((await agencyAccess()).level).toBe("locked");
        expect(await refusalCode(ctx)).toBe("subscription_inactive");
      },
    );
  });

  it("locks and logs the invariant break on past_due with no start, from both readers (AC-3)", async () => {
    await inRolledBackTransaction(
      { status: "past_due", pastDueSince: null },
      async (_tx, { ctx }) => {
        expect((await agencyAccess()).level).toBe("locked");
        expect(await refusalCode(ctx)).toBe("subscription_inactive");

        const invariantLines = warned
          .map((raw) => JSON.parse(raw) as Record<string, unknown>)
          .filter((line) => line.event === "access.invariant");

        expect(invariantLines).toHaveLength(2);
        for (const line of invariantLines) {
          expect(line.orgId).toBe(ctx.orgId);
          expect(line.reason).toBe("past_due_without_since");
        }
      },
    );
  });

  it("locks on a status this build has never seen (AC-1)", async () => {
    await inRolledBackTransaction(
      { status: "something_new", pastDueSince: null },
      async (_tx, { ctx }) => {
        expect((await agencyAccess()).level).toBe("locked");
        expect(await refusalCode(ctx)).toBe("subscription_inactive");
      },
    );
  });
});
