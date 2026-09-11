/**
 * @vitest-environment node
 *
 * covers: spec 0007 AC-11, AC-20, AC-21
 *
 * The route is the thin end of the webhook: it reads the raw body, finds the
 * signature header, opens the unscoped handle through `withSystemAccess`, and
 * turns the handler's result into a status. The ordering and the transaction
 * are proven in `src/payments/webhook.db.test.ts`; this file proves the wiring.
 *
 * The two 400 paths run the real handler against a gateway that refuses, so the
 * claim "an unverified body touches nothing" is checked against a database
 * handle that throws on any use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieveSubscription: vi.fn(),
  withSystemAccess: vi.fn(),
  handleStripeWebhook: vi.fn(),
}));

/** A database handle that fails loudly on any property access. */
const untouchableDb = new Proxy(
  {},
  {
    get: (_, property) => {
      throw new Error(
        `the database was touched (${String(property)}) on an unverified request`,
      );
    },
  },
);

vi.mock("@/db/tenant/system", () => ({
  withSystemAccess: mocks.withSystemAccess,
}));

vi.mock("@/payments/gateway", () => ({
  liveStripeGateway: () => ({
    constructEvent: mocks.constructEvent,
    retrieveSubscription: mocks.retrieveSubscription,
  }),
}));

vi.mock("@/payments/webhook", async (importActual) => {
  const actual = await importActual<typeof import("@/payments/webhook")>();
  mocks.handleStripeWebhook.mockImplementation(actual.handleStripeWebhook);

  return { ...actual, handleStripeWebhook: mocks.handleStripeWebhook };
});

const route = await import("./route");
const { handleStripeWebhook: realHandler } =
  await vi.importActual<typeof import("@/payments/webhook")>(
    "@/payments/webhook",
  );

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.handleStripeWebhook.mockImplementation(realHandler);
  mocks.withSystemAccess.mockImplementation(
    async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
      fn(untouchableDb),
  );
});

describe("route configuration (AC-20)", () => {
  it("is never prerendered and runs on Node, where the driver and raw body both work", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.runtime).toBe("nodejs");
  });
});

describe("an unverified request (AC-11)", () => {
  it("answers 400 with no signature header and never opens the database", async () => {
    const response = await route.POST(request("{}"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      outcome: "unverified",
    });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
  });

  it("answers 400 for a signature that does not verify, and touches nothing", async () => {
    mocks.constructEvent.mockRejectedValue(new Error("bad signature"));

    const response = await route.POST(
      request("{}", { "stripe-signature": "t=1,v1=nonsense" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      outcome: "unverified",
    });
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled();
  });

  it("logs one line for the failure that claims no event id (AC-21)", async () => {
    const warn = vi.mocked(console.warn);
    mocks.constructEvent.mockRejectedValue(new Error("bad signature"));

    await route.POST(request("{}", { "stripe-signature": "t=1,v1=nonsense" }));

    const lines = warn.mock.calls
      .map(([line]) => JSON.parse(line as string) as Record<string, unknown>)
      .filter((line) => line.event === "stripe.webhook");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      outcome: "unverified",
      reason: "bad_signature",
    });
    expect(lines[0]).not.toHaveProperty("eventId");
  });
});

describe("the raw body and the handle", () => {
  it("hands the handler the body byte for byte, never re serialised", async () => {
    const rawBody = '{"id":"evt_1",  "spacing":   "matters"}';
    mocks.constructEvent.mockRejectedValue(new Error("stop here"));

    await route.POST(request(rawBody, { "stripe-signature": "sig" }));

    expect(mocks.constructEvent).toHaveBeenCalledWith(rawBody, "sig");
  });

  it("opens the unscoped handle with a reason that says why there is no tenant", async () => {
    await route.POST(request("{}"));

    expect(mocks.withSystemAccess).toHaveBeenCalledTimes(1);
    const [reason] = mocks.withSystemAccess.mock.calls[0] as [string];
    expect(reason).toMatch(/stripe webhook/);
    expect(reason.trim()).not.toBe("");
  });

  it("passes the handle it was given straight to the handler", async () => {
    const handle = { marker: "system handle" };
    mocks.withSystemAccess.mockImplementation(
      async (_reason: string, fn: (db: unknown) => Promise<unknown>) =>
        fn(handle),
    );
    mocks.handleStripeWebhook.mockResolvedValue({
      status: 200,
      outcome: "handled",
      reason: "applied",
    });

    await route.POST(request("{}", { "stripe-signature": "sig" }));

    expect(mocks.handleStripeWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ db: handle, body: "{}", signature: "sig" }),
    );
  });
});

describe("the answer Stripe reads", () => {
  it.each([
    [200, "handled"],
    [200, "duplicate"],
    [200, "refused"],
    [200, "ignored"],
    [500, "failed"],
  ] as const)("returns %i for a %s outcome", async (status, outcome) => {
    mocks.handleStripeWebhook.mockResolvedValue({
      status,
      outcome,
      reason: "whatever the handler said",
    });

    const response = await route.POST(
      request("{}", { "stripe-signature": "sig" }),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toStrictEqual({ outcome });
  });

  it("never puts the reason, the payload or a row in the response body", async () => {
    mocks.handleStripeWebhook.mockResolvedValue({
      status: 500,
      outcome: "failed",
      reason: "connection to db-host-1 reset",
    });

    const response = await route.POST(
      request('{"secret":"payload"}', { "stripe-signature": "sig" }),
    );

    const text = await response.text();
    expect(text).not.toContain("db-host-1");
    expect(text).not.toContain("payload");
  });

  it("lets an unexpected throw propagate, so the provider retries", async () => {
    mocks.handleStripeWebhook.mockRejectedValue(new Error("shapes moved"));

    await expect(
      route.POST(request("{}", { "stripe-signature": "sig" })),
    ).rejects.toThrow("shapes moved");
  });
});
