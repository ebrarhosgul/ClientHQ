/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-16, AC-26
 *
 * The uuid guard in front of the organization lookup, without a database. The
 * lookup against real rows, including the soft deleted case, is proven in
 * `webhook.db.test.ts`; this file pins the one thing that decides whether
 * PostgreSQL is asked at all, because a malformed `org_id` reaching it would
 * raise, and a raise on the webhook path is a 500 that retries forever.
 */
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/tenant";

import { organizationExists } from "./organizations";

/** A `db.select().from().where().limit()` chain that resolves to `rows`. */
function fakeDb(rows: readonly { readonly id: string }[]): {
  readonly db: Database;
  readonly select: ReturnType<typeof vi.fn>;
} {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  }));

  return { db: { select } as unknown as Database, select };
}

const ORG_ID = "00000000-0000-7000-8000-000000000002";

describe("organizationExists", () => {
  it("is true when a row with that id exists", async () => {
    const { db } = fakeDb([{ id: ORG_ID }]);

    await expect(organizationExists(db, ORG_ID)).resolves.toBe(true);
  });

  it("is false when no row has that id", async () => {
    const { db } = fakeDb([]);

    await expect(organizationExists(db, ORG_ID)).resolves.toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["a Stripe id", "cus_123"],
    ["a uuid with a character missing", "00000000-0000-7000-8000-00000000000"],
    ["a SQL fragment", "' or 1=1 --"],
  ])(
    "answers false for %s without asking the database (AC-26)",
    async (_, orgId) => {
      const { db, select } = fakeDb([{ id: ORG_ID }]);

      await expect(organizationExists(db, orgId)).resolves.toBe(false);

      expect(select).not.toHaveBeenCalled();
    },
  );

  it("asks the database exactly once for a well formed id", async () => {
    const { db, select } = fakeDb([]);

    await organizationExists(db, ORG_ID);

    expect(select).toHaveBeenCalledTimes(1);
  });
});
