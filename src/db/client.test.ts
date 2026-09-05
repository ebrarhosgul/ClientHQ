/**
 * @vitest-environment node
 *
 * Tests for the database handle.
 *
 * `postgres` and `drizzle` are mocked because the boundary being checked is how
 * this module configures the driver, not whether Postgres answers. The two
 * connection options asserted here are the ones spec 0001 calls out as silent
 * footguns: prepared statements over the transaction pooler, and pool size in a
 * serverless function.
 *
 * The module runs its work at import time, so every test resets the registry
 * and imports it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Typed signatures, so `mock.calls[0][1]` is the options object rather than a
// value TypeScript believes cannot exist.
const postgresMock = vi.fn<
  (url: string, options: Record<string, unknown>) => unknown
>(() => ({ __brand: "sql-client" }));
const drizzleMock = vi.fn<
  (client: unknown, config: { schema: unknown }) => unknown
>(() => ({ __brand: "drizzle-db" }));
const envMock = vi.fn(() => ({
  NODE_ENV: "development" as const,
  DATABASE_URL: "postgres://user:pw@pooler.supabase.com:6543/postgres",
  DIRECT_URL: "postgres://user:pw@db.supabase.com:5432/postgres",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
}));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));
vi.mock("@/lib/env", () => ({ env: envMock }));

type GlobalWithCache = typeof globalThis & { __clienthqSql?: unknown };

function clearCachedClient() {
  delete (globalThis as GlobalWithCache).__clienthqSql;
}

/** Import a fresh copy, so the module's import time work runs again. */
async function importClient() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  clearCachedClient();
  postgresMock.mockClear();
  drizzleMock.mockClear();
  envMock.mockClear();
});

afterEach(() => {
  // NODE_ENV is typed read only, so it is set through Vitest rather than by
  // assignment, and unset again here.
  vi.unstubAllEnvs();
  clearCachedClient();
  vi.resetModules();
});

describe("db client", () => {
  it("connects with the DATABASE_URL from the validated environment", async () => {
    await importClient();

    expect(postgresMock).toHaveBeenCalledOnce();
    expect(postgresMock.mock.calls[0][0]).toBe(
      "postgres://user:pw@pooler.supabase.com:6543/postgres",
    );
  });

  it("reads the connection string through env(), never straight from process.env", async () => {
    // Going around the validated environment is how an unset variable becomes a
    // confusing runtime error instead of a clear startup one.
    await importClient();

    expect(envMock).toHaveBeenCalled();
  });

  it("disables prepared statements, which the transaction pooler cannot keep", async () => {
    await importClient();

    expect(postgresMock.mock.calls[0][1]).toMatchObject({ prepare: false });
  });

  it("holds at most one connection per function instance", async () => {
    await importClient();

    expect(postgresMock.mock.calls[0][1]).toMatchObject({ max: 1 });
  });

  it("hands the schema to drizzle, so queries are typed against it", async () => {
    await importClient();

    expect(drizzleMock).toHaveBeenCalledOnce();
    expect(drizzleMock.mock.calls[0][1]).toMatchObject({ schema: expect.anything() });
  });

  it("exports the drizzle instance as db", async () => {
    const mod = await importClient();

    expect(mod.db).toEqual({ __brand: "drizzle-db" });
  });

  describe("outside production", () => {
    it("caches the driver on globalThis so a dev reload does not open a second pool", async () => {
      vi.stubEnv("NODE_ENV", "development");

      await importClient();

      expect((globalThis as GlobalWithCache).__clienthqSql).toEqual({
        __brand: "sql-client",
      });
    });

    it("reuses the cached driver on the next import instead of connecting again", async () => {
      vi.stubEnv("NODE_ENV", "development");

      await importClient();
      await importClient();

      // Supabase's free tier connection budget is small; a reload per edit
      // would exhaust it within a working session.
      expect(postgresMock).toHaveBeenCalledOnce();
    });
  });

  describe("in production", () => {
    it("does not leave the driver on globalThis", async () => {
      vi.stubEnv("NODE_ENV", "production");

      await importClient();

      expect((globalThis as GlobalWithCache).__clienthqSql).toBeUndefined();
    });

    it("opens its own connection per instance rather than sharing one", async () => {
      vi.stubEnv("NODE_ENV", "production");

      await importClient();
      await importClient();

      expect(postgresMock).toHaveBeenCalledTimes(2);
    });
  });
});
