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
  // Added by the tenant scoping layer (spec 0003): the session module reads
  // Clerk claims, and Clerk picks these two up from the process environment.
  CLERK_SECRET_KEY: "sk_test_not_a_real_key",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_not_a_real_key",
  // Added by agency sign in & organization (spec 0005): Clerk's SDK reads these
  // four itself, and they are declared so a missing one fails here rather than
  // by sending someone to a route that does not exist.
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/onboarding",
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/onboarding",
  // Added by subscription checkout & Stripe webhook (spec 0007). All four come
  // from the Stripe dashboard. The publishable key is required while nothing
  // reads it, which spec 0007 chose deliberately so a later embedded payment
  // surface is a code change rather than an environment change everywhere.
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_secret",
  STRIPE_PRICE_ID: "price_not_a_real_price",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_not_a_real_key",
  // Added by client contacts & portal invitations (spec 0009): the sending
  // address is required everywhere; the Resend key only in production.
  EMAIL_FROM: "invites@example.com",
} as const;

// Added by deliverable upload & download (spec 0011): the four R2 variables
// are required in production, alongside RESEND_API_KEY, whenever a test
// exercises a production environment for a reason unrelated to either rule.
const PRODUCTION_R2 = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket",
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

/** A complete environment with one variable left out. */
function withoutKey(missing: keyof typeof VALID): Record<string, string> {
  return Object.fromEntries(
    Object.entries(VALID).filter(([name]) => name !== missing),
  );
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

    it("returns the two Clerk keys the session module needs", async () => {
      setProcessEnv({ ...VALID });

      const env = await freshEnv();
      const result: ServerEnv = env();

      expect(result.CLERK_SECRET_KEY).toBe(VALID.CLERK_SECRET_KEY);
      expect(result.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe(
        VALID.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      );
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
        // Production also needs the Resend key (spec 0009) and the R2 group
        // (spec 0011); see their own describe blocks for the rules themselves.
        setProcessEnv({
          ...VALID,
          NODE_ENV: nodeEnv,
          RESEND_API_KEY: "re_not_a_real_key",
          ...PRODUCTION_R2,
        });

        const env = await freshEnv();

        expect(env().NODE_ENV).toBe(nodeEnv);
      },
    );
  });

  describe("a broken environment", () => {
    it("throws when DATABASE_URL is missing", async () => {
      setProcessEnv(withoutKey("DATABASE_URL"));

      const env = await freshEnv();

      expect(() => env()).toThrow(/DATABASE_URL/);
    });

    it("throws when DIRECT_URL is missing", async () => {
      setProcessEnv(withoutKey("DIRECT_URL"));

      const env = await freshEnv();

      expect(() => env()).toThrow(/DIRECT_URL/);
    });

    it("throws when a Clerk key is missing", async () => {
      setProcessEnv(withoutKey("CLERK_SECRET_KEY"));

      const env = await freshEnv();

      expect(() => env()).toThrow(/CLERK_SECRET_KEY/);
    });

    it.each([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ID",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    ] as const)(
      "throws when %s is missing, so a deploy without Stripe fails at boot rather than at checkout (spec 0007)",
      async (key) => {
        setProcessEnv(withoutKey(key));

        const env = await freshEnv();

        expect(() => env()).toThrow(new RegExp(key));
      },
    );

    describe("email (spec 0009)", () => {
      it("throws when EMAIL_FROM is missing", async () => {
        setProcessEnv(withoutKey("EMAIL_FROM"));

        const env = await freshEnv();

        expect(() => env()).toThrow(/EMAIL_FROM/);
      });

      it("throws when EMAIL_FROM is not a bare address", async () => {
        setProcessEnv({ ...VALID, EMAIL_FROM: "Acme <invites@example.com>" });

        const env = await freshEnv();

        expect(() => env()).toThrow(/EMAIL_FROM/);
      });

      it("accepts a missing RESEND_API_KEY outside production, so the console transport can run", async () => {
        setProcessEnv({ ...VALID, NODE_ENV: "development" });

        const env = await freshEnv();

        expect(env().RESEND_API_KEY).toBeUndefined();
      });

      it("requires RESEND_API_KEY in production", async () => {
        setProcessEnv({ ...VALID, NODE_ENV: "production" });

        const env = await freshEnv();

        expect(() => env()).toThrow(/RESEND_API_KEY is required in production/);
      });

      it("accepts RESEND_API_KEY in production when it is set", async () => {
        setProcessEnv({
          ...VALID,
          NODE_ENV: "production",
          RESEND_API_KEY: "re_not_a_real_key",
          ...PRODUCTION_R2,
        });

        const env = await freshEnv();

        expect(env().RESEND_API_KEY).toBe("re_not_a_real_key");
      });
    });

    describe("deliverable storage, R2 (spec 0011)", () => {
      it("accepts a missing R2_* group outside production, so the app runs with storage unconfigured", async () => {
        setProcessEnv({ ...VALID, NODE_ENV: "development" });

        const env = await freshEnv();

        expect(env().R2_ACCOUNT_ID).toBeUndefined();
        expect(env().R2_ACCESS_KEY_ID).toBeUndefined();
        expect(env().R2_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env().R2_BUCKET).toBeUndefined();
      });

      it.each([
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
      ] as const)("requires %s in production", async (key) => {
        const group: Record<string, string> = {
          R2_ACCOUNT_ID: "account",
          R2_ACCESS_KEY_ID: "key",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_BUCKET: "bucket",
        };
        delete group[key];

        setProcessEnv({
          ...VALID,
          NODE_ENV: "production",
          RESEND_API_KEY: "re_not_a_real_key",
          ...group,
        });

        const env = await freshEnv();

        expect(() => env()).toThrow(
          new RegExp(`${key} is required in production`),
        );
      });

      it("accepts the full R2_* group in production", async () => {
        setProcessEnv({
          ...VALID,
          NODE_ENV: "production",
          RESEND_API_KEY: "re_not_a_real_key",
          R2_ACCOUNT_ID: "account",
          R2_ACCESS_KEY_ID: "key",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_BUCKET: "bucket",
        });

        const env = await freshEnv();

        expect(env().R2_BUCKET).toBe("bucket");
      });

      it("accepts the two R2_ADMIN_* variables everywhere, since Vercel never sets them", async () => {
        setProcessEnv({
          ...VALID,
          NODE_ENV: "production",
          RESEND_API_KEY: "re_not_a_real_key",
          R2_ACCOUNT_ID: "account",
          R2_ACCESS_KEY_ID: "key",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_BUCKET: "bucket",
        });

        const env = await freshEnv();

        expect(env().R2_ADMIN_ACCESS_KEY_ID).toBeUndefined();
        expect(env().R2_ADMIN_SECRET_ACCESS_KEY).toBeUndefined();
      });
    });

    it("never puts the Stripe secret key or webhook secret into the error message", async () => {
      setProcessEnv({
        STRIPE_SECRET_KEY: VALID.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: VALID.STRIPE_WEBHOOK_SECRET,
      });

      const env = await freshEnv();

      expect(() => env()).toThrow();
      try {
        env();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(VALID.STRIPE_SECRET_KEY);
        expect(message).not.toContain(VALID.STRIPE_WEBHOOK_SECRET);
      }
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
