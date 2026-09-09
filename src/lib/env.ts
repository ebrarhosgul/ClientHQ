import { z } from "zod";

/**
 * Server side environment, validated once at first import.
 *
 * Importing this from client code is a mistake: it would leak secrets into the
 * browser bundle. Only server files (Server Components, Server Actions, route
 * handlers) may import it.
 *
 * Each feature adds its own variables here when it is built, rather than the
 * scaffold demanding every provider up front. See `.env.example` for the full
 * list spec 0001 calls for and which feature switches each one on.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** Supabase transaction mode pooler, port 6543. Every runtime query. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** Direct connection, port 5432. Migrations only. */
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  /** Absolute base URL, used later by Stripe redirects and email links. */
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  /**
   * Clerk. The tenant scoping layer (feature 4) reads session claims through
   * `@clerk/nextjs/server`, which picks these up from the process environment
   * itself; they are declared here so a missing key fails with this message
   * rather than somewhere inside the SDK. Feature 6 adds the sign in flow.
   */
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required"),

  /**
   * Development only. A database host besides `localhost` that `pnpm db:seed`
   * may write to. Unset, the seed refuses every remote host.
   */
  SEED_ALLOW_HOST: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Environment is not valid:\n${problems}\n\n` +
        `Copy .env.example to .env.local and fill in the values.`,
    );
  }

  return parsed.data;
}

let cached: ServerEnv | undefined;

/**
 * Read the validated server environment.
 *
 * This is a function rather than a top level constant on purpose: it keeps the
 * validation out of the build step, so `next build` does not need real
 * credentials to compile pages that never touch the database.
 */
export function env(): ServerEnv {
  cached ??= loadEnv();
  return cached;
}

/**
 * Is Clerk configured on this machine?
 *
 * The one place in the project that reads `process.env` outside `env()`, and it
 * has to: `env()` throws when a required key is missing, which is exactly the
 * question being asked here, and Next only inlines a `NEXT_PUBLIC_` variable
 * into the browser bundle when it is written out in full like this.
 *
 * Two things depend on the answer. `ClerkProvider` throws without a
 * publishable key, so the root layout only mounts it when there is one; and the
 * agency shell then renders its signed out state, which spec 0004 already
 * requires it to handle (AC-22). That keeps the browser suite in CI free of
 * provider credentials, which the CI workflow is explicit about wanting, and it
 * lets someone clone this repository and see the product without signing up to
 * anything first.
 *
 * With a key present nothing changes: Clerk wraps the app and runs on every
 * request, exactly as AC-18 says.
 */
export function clerkPublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || undefined;
}

export function isClerkConfigured(): boolean {
  return clerkPublishableKey() !== undefined;
}
