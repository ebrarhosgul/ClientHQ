/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-13 (the one file that reaches the raw handle) and the
 * reason its import is dynamic
 *
 * The "nowhere else imports the handle" half of AC-13 is a lint rule, proved in
 * `tools/eslint/tenant-isolation-config.test.mts`. What is left for a unit test
 * is the part the comment at the top of `executor.ts` promises: merely loading
 * the tenant layer must not pull in `src/db/client.ts`, because that module
 * reads `DATABASE_URL` at module scope and would drag a live credential into
 * every unit test and every prerender.
 *
 * The mock is a *getter*, so the tests can tell apart loading the module and
 * actually reading the handle off it. That distinction is the whole subject of
 * this file.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  reads: 0,
  handle: { marker: "the pooled handle" },
}));

vi.mock("../client", () => ({
  get db() {
    client.reads += 1;

    return client.handle;
  },
}));

beforeEach(() => {
  client.reads = 0;
  // A fresh module registry, so `pooledDb`'s own cache starts empty each time.
  vi.resetModules();
});

describe("pooledDb", () => {
  it("hands back the handle from src/db/client.ts", async () => {
    const { pooledDb } = await import("./executor");

    await expect(pooledDb()).resolves.toStrictEqual({
      marker: "the pooled handle",
    });
  });

  it("loads the handle once and reuses it", async () => {
    const { pooledDb } = await import("./executor");

    const first = await pooledDb();
    const second = await pooledDb();
    const third = await pooledDb();

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(client.reads).toBe(1);
  });

  it("does not read the handle until someone actually asks for one", async () => {
    // Importing the tenant layer must not be enough to require a connection
    // string. This is the whole reason the import inside `pooledDb` is dynamic.
    const { pooledDb } = await import("./executor");

    expect(client.reads).toBe(0);

    await pooledDb();

    expect(client.reads).toBe(1);
  });

  it("keeps the handle across separate importers of the module", async () => {
    const first = await (await import("./executor")).pooledDb();
    const second = await (await import("./executor")).pooledDb();

    expect(second).toBe(first);
    expect(client.reads).toBe(1);
  });
});
