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
   * Feature 6, the sign in flow. Clerk's own SDK reads these four straight from
   * `process.env`, so nothing in the project calls `env()` for them; they are
   * declared here so a missing one fails with this project's message instead of
   * sending someone to a route that does not exist (spec 0005, AC-19).
   *
   * The two URL variables have to agree with the routes under `src/app`, and
   * both fallbacks point at `/onboarding`, which is what decides where a
   * completed sign in or sign up actually lands.
   */
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_SIGN_IN_URL is required"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_SIGN_UP_URL is required"),
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL is required"),
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL is required"),

  /**
   * Feature 8, subscription checkout and the Stripe webhook (spec 0007).
   *
   * Three of these come from the Stripe dashboard and cannot be invented here:
   * the Price carries the 14 day trial, so the trial length lives in Stripe and
   * nowhere in this repository, and the webhook secret only exists once the
   * endpoint is registered. Spec 0007's "Stripe dashboard prerequisites" lists
   * what has to be set up before any of this runs.
   */
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
  /** The monthly subscription price. The 14 day trial is configured on it. */
  STRIPE_PRICE_ID: z.string().min(1, "STRIPE_PRICE_ID is required"),
  /**
   * Required while nothing reads it, which spec 0007 chose deliberately. Hosted
   * Checkout redirects rather than mounting Stripe.js, so this feature never
   * needs it; declaring it now means a later embedded payment surface is a code
   * change rather than an environment change across every deploy target.
   */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required"),

  /**
   * A dedicated user in the Clerk development instance, read only by the
   * browser suite so it has a documented way past the sign in screen. Optional
   * because nothing the application runs needs it, and CI deliberately runs the
   * browser suite with no Clerk credentials at all.
   */
  E2E_CLERK_USER_USERNAME: z.string().min(1).optional(),
  E2E_CLERK_USER_PASSWORD: z.string().min(1).optional(),

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
