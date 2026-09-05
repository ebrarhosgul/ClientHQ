/**
 * @vitest-environment node
 *
 * Tests for the validated server environment.
 *
 * `env()` caches its result in module scope, so most tests import the module
 * fresh (`vi.resetModules()` plus a dynamic import) after setting `process.env`.
 * Importing once at the top of the file would freeze whatever the first test
 * happened to set.
 *
 * covers: spec 0001, "Configuration required" (DATABASE_URL, DIRECT_URL,
 * NEXT_PUBLIC_APP_URL) and the scaffold's claim that validation happens at
 * first use rather than at build time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerEnv } from "./env";

const VALID = {
  DATABASE_URL: "postgres://user:pw@pooler.supabase.com:6543/postgres",
  DIRECT_URL: "postgres://user:pw@db.supabase.com:5432/postgres",
} as const;

/**
 * Replace the whole process environment.
 *
 * `NodeJS.ProcessEnv` insists on NODE_ENV, and half these tests are about what
 * happens when a variable is absent, so the cast goes through `unknown` here in
 * one place rather than at every call site.
 */
function setProcessEnv(vars: Record<string, string>): void {
  process.env = vars as unknown as NodeJS.ProcessEnv;
}

/** Import a fresh copy of the module, so the cache starts empty. */
async function freshEnv() {
  vi.resetModules();
  const mod = await import("./env");
  return mod.env;
}

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = process.env;
  // A blank slate, so a variable set in the developer's own shell or in .env
  // cannot make a "missing variable" test pass by accident.
  setProcessEnv({});
});

afterEach(() => {
  process.env = originalEnv;
  vi.resetModules();
});

describe("env", () => {
  describe("a complete environment", () => {
    it("returns the two connection strings it was given", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();
      const result: ServerEnv = env();

      expect(result.DATABASE_URL).toBe(VALID.DATABASE_URL);
      expect(result.DIRECT_URL).toBe(VALID.DIRECT_URL);
    });

    it("defaults NODE_ENV to development when it is not set", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();

      expect(env().NODE_ENV).toBe("development");
    });

    it("defaults NEXT_PUBLIC_APP_URL to localhost when it is not set", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();

      expect(env().NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    });

    it("keeps a NEXT_PUBLIC_APP_URL that was set, rather than the default", async () => {
      setProcessEnv({
        ...VALID,
        NEXT_PUBLIC_APP_URL: "https://clienthq.vercel.app",
      });

      const env = await freshEnv();

      expect(env().NEXT_PUBLIC_APP_URL).toBe("https://clienthq.vercel.app");
    });

    it.each(["development", "test", "production"] as const)(
      "accepts NODE_ENV=%s",
      async (nodeEnv) => {
        setProcessEnv({ ...VALID, NODE_ENV: nodeEnv });

        const env = await freshEnv();

        expect(env().NODE_ENV).toBe(nodeEnv);
      },
    );
  });

  describe("a broken environment", () => {
    it("throws when DATABASE_URL is missing", async () => {
      setProcessEnv({ DIRECT_URL: VALID.DIRECT_URL });

      const env = await freshEnv();

      expect(() => env()).toThrow(/DATABASE_URL/);
    });

    it("throws when DIRECT_URL is missing", async () => {
      setProcessEnv({ DATABASE_URL: VALID.DATABASE_URL });

      const env = await freshEnv();

      expect(() => env()).toThrow(/DIRECT_URL/);
    });

    it("treats an empty string as missing, not as a value", async () => {
      setProcessEnv({ ...VALID, DATABASE_URL: "" });

      const env = await freshEnv();

      expect(() => env()).toThrow(/DATABASE_URL is required/);
    });

    it("reports every problem at once, not just the first", async () => {
      setProcessEnv({});

      const env = await freshEnv();

      // One run of the app, one complete list of what to fix.
      expect(() => env()).toThrow(/DATABASE_URL[\s\S]*DIRECT_URL/);
    });

    it("rejects a NEXT_PUBLIC_APP_URL that is not a URL", async () => {
      setProcessEnv({
        ...VALID,
        NEXT_PUBLIC_APP_URL: "clienthq.vercel.app",
      });

      const env = await freshEnv();

      expect(() => env()).toThrow(/NEXT_PUBLIC_APP_URL/);
    });

    it("rejects a NODE_ENV outside the three it knows", async () => {
      setProcessEnv({ ...VALID, NODE_ENV: "staging" });

      const env = await freshEnv();

      expect(() => env()).toThrow(/NODE_ENV/);
    });

    it("points at .env.example rather than only naming the failure", async () => {
      setProcessEnv({});

      const env = await freshEnv();

      expect(() => env()).toThrow(/\.env\.example/);
    });

    it("never puts a credential into the error message", async () => {
      // DATABASE_URL is valid here, so it is not the thing being reported. It
      // must still not be swept into the message: this error reaches logs and
      // error tracking, where a connection string is a leaked secret.
      setProcessEnv({ DATABASE_URL: VALID.DATABASE_URL });

      const env = await freshEnv();

      expect(() => env()).toThrow();
      try {
        env();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(VALID.DATABASE_URL);
        expect(message).not.toContain("pw@");
      }
    });
  });

  describe("caching", () => {
    it("hands back the same object every call", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();

      expect(env()).toBe(env());
    });

    it("does not re-read process.env once it has succeeded", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();
      const before = env().DATABASE_URL;

      process.env.DATABASE_URL = "postgres://changed@example.com:6543/postgres";

      // A long lived server should not change its database mid flight because
      // something mutated process.env.
      expect(env().DATABASE_URL).toBe(before);
    });

    it("keeps throwing when the environment is broken, rather than caching a failure once", async () => {
      setProcessEnv({});

      const env = await freshEnv();

      expect(() => env()).toThrow();
      expect(() => env()).toThrow();
    });
  });
});
