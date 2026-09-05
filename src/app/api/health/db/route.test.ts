/**
 * @vitest-environment node
 *
 * Tests for the database health route.
 *
 * The database module is mocked at the boundary: the point of this route is what
 * it says to an unauthenticated caller, not whether Postgres is up. Its stated
 * contract is that it reports whether the connection works and never why it
 * failed, so the failure case is the one that carries real weight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.fn();

vi.mock("@/db/client", () => ({ db: { execute: executeMock } }));

const LEAKY_ERROR = new Error(
  'getaddrinfo ENOTFOUND aws-0-eu-west-2.pooler.supabase.com, user "postgres.abcdefghijklmno", password "s3cr3t-pw"',
);

beforeEach(() => {
  executeMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health/db", () => {
  describe("route configuration", () => {
    it("runs on the Node runtime, since the driver needs a TCP socket", async () => {
      const { runtime } = await import("./route");

      expect(runtime).toBe("nodejs");
    });

    it("is never prerendered, so it cannot answer from a build time snapshot", async () => {
      const { dynamic, revalidate } = await import("./route");

      expect(dynamic).toBe("force-dynamic");
      expect(revalidate).toBe(0);
    });
  });

  describe("when the database answers", () => {
    it("responds 200", async () => {
      executeMock.mockResolvedValue([{ "?column?": 1 }]);
      const { GET } = await import("./route");

      const response = await GET();

      expect(response.status).toBe(200);
    });

    it("reports the connection as reachable", async () => {
      executeMock.mockResolvedValue([{ "?column?": 1 }]);
      const { GET } = await import("./route");

      const body = await (await GET()).json();

      expect(body).toMatchObject({ status: "ok", database: "reachable" });
    });

    it("includes a round trip time as a number, not a string", async () => {
      executeMock.mockResolvedValue([{ "?column?": 1 }]);
      const { GET } = await import("./route");

      const body = await (await GET()).json();

      expect(typeof body.roundTripMs).toBe("number");
      expect(body.roundTripMs).toBeGreaterThanOrEqual(0);
    });

    it("makes exactly one round trip, and writes nothing", async () => {
      executeMock.mockResolvedValue([{ "?column?": 1 }]);
      const { GET } = await import("./route");

      await GET();

      expect(executeMock).toHaveBeenCalledOnce();
    });

    it("asks only for select 1, touching no table and no tenant data", async () => {
      executeMock.mockResolvedValue([{ "?column?": 1 }]);
      const { GET } = await import("./route");

      await GET();

      // A health check that reads a real table would fail for reasons that have
      // nothing to do with the connection.
      const statement = JSON.stringify(executeMock.mock.calls[0][0]);
      expect(statement).toContain("select 1");
    });
  });

  describe("when the database is unreachable", () => {
    it("responds 503 rather than 200 or 500", async () => {
      executeMock.mockRejectedValue(LEAKY_ERROR);
      const { GET } = await import("./route");

      const response = await GET();

      expect(response.status).toBe(503);
    });

    it("reports the connection as unreachable", async () => {
      executeMock.mockRejectedValue(LEAKY_ERROR);
      const { GET } = await import("./route");

      const body = await (await GET()).json();

      expect(body).toEqual({ status: "error", database: "unreachable" });
    });

    it("never puts the host, the user or the password in the response", async () => {
      // This route is unauthenticated. A connection error naturally carries the
      // host and the user, and returning it hands an attacker the shape of the
      // infrastructure.
      executeMock.mockRejectedValue(LEAKY_ERROR);
      const { GET } = await import("./route");

      const raw = await (await GET()).text();

      expect(raw).not.toContain("pooler.supabase.com");
      expect(raw).not.toContain("postgres.abcdefghijklmno");
      expect(raw).not.toContain("s3cr3t-pw");
      expect(raw).not.toContain("ENOTFOUND");
    });

    it("sends the real reason to the server log instead", async () => {
      executeMock.mockRejectedValue(LEAKY_ERROR);
      const { GET } = await import("./route");

      await GET();

      // Hidden from the caller, still visible to whoever is on call.
      expect(console.error).toHaveBeenCalledWith(
        "[health/db] database unreachable",
        LEAKY_ERROR,
      );
    });

    it("stays quiet the same way when the failure is not an Error object", async () => {
      executeMock.mockRejectedValue("connection refused at 10.0.0.4:6543");
      const { GET } = await import("./route");

      const response = await GET();
      const raw = await response.text();

      expect(response.status).toBe(503);
      expect(raw).not.toContain("10.0.0.4");
    });

    it("does not reject, so the route never becomes a 500 with a stack trace", async () => {
      executeMock.mockRejectedValue(LEAKY_ERROR);
      const { GET } = await import("./route");

      await expect(GET()).resolves.toBeDefined();
    });
  });
});
