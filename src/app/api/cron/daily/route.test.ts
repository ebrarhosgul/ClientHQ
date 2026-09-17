/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-1, AC-2, AC-11
 *
 * The route is the thin end of the sweep: the secret check, opening the
 * unscoped handle, and turning the runner's result into a status. The runner
 * itself, and the sweeps it runs, are proven in `src/cron/runner.test.ts` and
 * each sweep's own tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withSystemAccess: vi.fn(),
  runDailySweeps: vi.fn(),
  isAuthorized: vi.fn(),
  logCronUnauthorized: vi.fn(),
}));

/** A database handle that fails loudly on any property access. */
const untouchableDb = new Proxy(
  {},
  {
    get: (_, property) => {
      throw new Error(
        `the database was touched (${String(property)}) on an unscoped call`,
      );
    },
  },
);

vi.mock("@/db/tenant/system", () => ({
  withSystemAccess: mocks.withSystemAccess,
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ CRON_SECRET: "the-real-secret" }),
}));

vi.mock("@/cron/daily", () => ({
  DAILY_SWEEPS: ["marker-sweep-list"],
}));

vi.mock("@/cron/runner", () => ({
  runDailySweeps: mocks.runDailySweeps,
}));

vi.mock("@/cron/secret", () => ({
  isAuthorized: mocks.isAuthorized,
}));

vi.mock("@/cron/log", () => ({
  logCronUnauthorized: mocks.logCronUnauthorized,
}));

const route = await import("./route");

function request(header?: string): Request {
  return new Request("http://localhost/api/cron/daily", {
    method: "GET",
    headers: header === undefined ? {} : { authorization: header },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAuthorized.mockReturnValue(true);
  mocks.withSystemAccess.mockImplementation(
    async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
      fn(untouchableDb),
  );
  mocks.runDailySweeps.mockResolvedValue({
    runId: "00000000-0000-7000-8000-000000000001",
    outcome: "ok",
    sweeps: [],
  });
});

describe("route configuration (AC-11)", () => {
  it("is never prerendered, runs on Node, and gets the full budget", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
    expect(route.maxDuration).toBe(300);
  });
});

describe("authorization (AC-1)", () => {
  it("answers 401 with an empty body when unauthorized, and reads and writes nothing", async () => {
    mocks.isAuthorized.mockReturnValue(false);

    const response = await route.GET(request("Bearer wrong") as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(mocks.withSystemAccess).not.toHaveBeenCalled();
    expect(mocks.logCronUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("checks the header against the configured secret", async () => {
    await route.GET(request("Bearer the-real-secret") as never);

    expect(mocks.isAuthorized).toHaveBeenCalledWith(
      "Bearer the-real-secret",
      "the-real-secret",
    );
  });

  it("passes a null header through unchanged when none is set", async () => {
    await route.GET(request() as never);

    expect(mocks.isAuthorized).toHaveBeenCalledWith(null, "the-real-secret");
  });
});

describe("an authorized run", () => {
  it("opens the unscoped handle with a reason naming why there is no tenant", async () => {
    await route.GET(request("Bearer the-real-secret") as never);

    expect(mocks.withSystemAccess).toHaveBeenCalledTimes(1);
    const [reason] = mocks.withSystemAccess.mock.calls[0] as [string];
    expect(reason.trim()).not.toBe("");
    expect(reason).toMatch(/daily cron/);
  });

  it("runs the wired sweeps against the handle it was given", async () => {
    const handle = { marker: "system handle" };
    mocks.withSystemAccess.mockImplementation(
      async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
        fn(handle),
    );

    await route.GET(request("Bearer the-real-secret") as never);

    expect(mocks.runDailySweeps).toHaveBeenCalledWith(
      expect.objectContaining({ db: handle, sweeps: ["marker-sweep-list"] }),
    );
    const [{ now }] = mocks.runDailySweeps.mock.calls[0] as [{ now: Date }];
    expect(now).toBeInstanceOf(Date);
  });

  it.each([
    ["ok", 200],
    ["failed", 500],
  ] as const)("answers %i for a %s run", async (outcome, status) => {
    mocks.runDailySweeps.mockResolvedValue({
      runId: "run-1",
      outcome,
      sweeps: [],
    });

    const response = await route.GET(
      request("Bearer the-real-secret") as never,
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      runId: "run-1",
      outcome,
    });
  });
});
