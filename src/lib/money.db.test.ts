/**
 * @vitest-environment node
 *
 * covers: spec 0002 AC-3, AC-5 (the TypeScript rounding and the PostgreSQL
 * rounding agree at the boundaries)
 *
 * `src/lib/money.ts` and the CHECK constraints compute the same values, and
 * both must round half away from zero. This runs the boundary cases through a
 * real PostgreSQL and compares. It reads only, so it needs no schema and writes
 * nothing.
 *
 * Skipped when `DIRECT_URL` is not set, so the unit suite runs without a
 * database. CI's container job sets it and runs this file explicitly.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnvFiles } from "./load-env-files";
import { lineAmountCents, taxCents } from "./money";

loadEnvFiles();

const url = process.env.DIRECT_URL;

describe.skipIf(!url)("money.ts agrees with PostgreSQL round()", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 1 });

  afterAll(async () => {
    await sql.end();
  });

  const lines: readonly [string, number][] = [
    ["0.5", 1],
    ["1.5", 1],
    ["2.5", 1],
    ["0.005", 100],
    ["0.004", 100],
    ["0.333", 300],
    ["2.5", 1000],
    ["999999999.999", 1],
  ];

  it.each(lines)(
    "round(%s * %d) matches lineAmountCents",
    async (quantity, unit) => {
      const [row] = await sql<{ amount: string }[]>`
        select round(${quantity}::numeric(12,3) * ${unit}::integer)::text as amount`;
      expect(Number(row.amount)).toBe(lineAmountCents(quantity, unit));
    },
  );

  const taxes: readonly [number, number][] = [
    [25, 1500],
    [5, 500],
    [10, 500],
    [100, 2000],
    [1, 1],
    [1000000000, 10000],
  ];

  it.each(taxes)(
    "round(%d * %d / 10000) matches taxCents",
    async (subtotal, rate) => {
      const [row] = await sql<{ tax: string }[]>`
        select round((${subtotal}::integer::numeric * ${rate}::integer) / 10000)::text as tax`;
      expect(Number(row.tax)).toBe(taxCents(subtotal, rate));
    },
  );
});
