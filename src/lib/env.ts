import { z } from "zod";

/**
 * An optional provider or credential variable, `undefined` and an explicit
 * empty string treated the same way.
 *
 * `playwright.config.ts` blanks every one of these to `""` rather than
 * deleting the key, in the webServer envs that must prove a provider is off
 * (spec 0019, AC-22, AC-23) — deleting it would let a developer's own value
 * from `.env.local` show back through, since Playwright's `env` is merged
 * onto the parent process's environment rather than replacing it outright.
 * A bare `z.string().min(1).optional()` rejects that `""` as invalid, which
 * is only reachable once something in the request calls `env()`; every
 * other optional field here shares the same contract, so it gets the same
 * treatment.
 */
function optionalEnv(): z.ZodType<string | undefined> {
  return z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  );
}

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
   * Feature 17, the Clerk webhook (spec 0015). The `whsec_...` value of the
   * Clerk dashboard endpoint (or the local relay's own), used by
   * `verifyWebhook`. There is no default: the endpoint does not exist until
   * someone registers it, and this secret is what proves a delivery came from
   * there.
   */
  CLERK_WEBHOOK_SIGNING_SECRET: z
    .string()
    .min(1, "CLERK_WEBHOOK_SIGNING_SECRET is required"),

  /**
   * A dedicated user in the Clerk development instance, read only by the
   * browser suite so it has a documented way past the sign in screen. Optional
   * because nothing the application runs needs it, and CI deliberately runs the
   * browser suite with no Clerk credentials at all.
   */
  E2E_CLERK_USER_USERNAME: optionalEnv(),
  E2E_CLERK_USER_PASSWORD: optionalEnv(),

  /**
   * Feature 15, the client portal (spec 0014). A second dedicated user in the
   * Clerk development instance, this one with no agency membership, so the
   * browser suite has a documented way to walk the contact path. Never read
   * by the application itself; `scripts/db-seed.ts` writes the id onto the
   * seeded contact so her accepted row binds to this real account, and the
   * suite skips when any of the three is unset, exactly as the staff one does.
   */
  E2E_CLERK_CONTACT_USERNAME: optionalEnv(),
  E2E_CLERK_CONTACT_PASSWORD: optionalEnv(),
  E2E_CLERK_CONTACT_USER_ID: optionalEnv(),

  /**
   * Development only. A database host besides `localhost` that `pnpm db:seed`
   * may write to. Unset, the seed refuses every remote host.
   */
  SEED_ALLOW_HOST: optionalEnv(),

  /**
   * Feature 10, client contacts and portal invitations (spec 0009). The first
   * email the product sends, and the transport every later email reuses.
   *
   * `RESEND_API_KEY` is optional outside production: without it the console
   * transport in `src/email/send.ts` prints the message instead of sending it,
   * which is what lets the invitation flow be walked with no provider account.
   * In production it is required, enforced by the refinement below rather than
   * here, because a plain `min(1)` would demand it in development too.
   *
   * `EMAIL_FROM` is the bare sending address on a domain verified in the Resend
   * dashboard. The display name is composed per send, never stored here.
   */
  RESEND_API_KEY: optionalEnv(),
  EMAIL_FROM: z.email("EMAIL_FROM must be a bare email address"),

  /**
   * Feature 12, deliverable upload and download (spec 0011). Cloudflare R2,
   * which speaks the S3 API, is where every deliverable's bytes live.
   *
   * All four are optional outside production, exactly like `RESEND_API_KEY`:
   * without them `isStorageConfigured()` is `false`, the Deliverables section
   * shows a notice instead of an upload control, and every write refuses with
   * `conflict` before touching a row (AC-18). Required in production by the
   * refinement below.
   */
  R2_ACCOUNT_ID: optionalEnv(),
  R2_ACCESS_KEY_ID: optionalEnv(),
  R2_SECRET_ACCESS_KEY: optionalEnv(),
  R2_BUCKET: optionalEnv(),

  /**
   * `scripts/r2-setup.ts` only, never the app: an Admin Read and Write token
   * for the operator running the bucket setup script. Optional in every
   * environment, including production, because Vercel never carries it.
   */
  R2_ADMIN_ACCESS_KEY_ID: optionalEnv(),
  R2_ADMIN_SECRET_ACCESS_KEY: optionalEnv(),

  /**
   * Feature 18, daily cron sweeps (spec 0017). The bearer token
   * `/api/cron/daily` requires and Vercel Cron sends. Required in every
   * environment, unlike the providers above: an unset secret would otherwise
   * open the route rather than fail closed, so there is no unconfigured state
   * for this one. At least 16 characters so a guessed or truncated value
   * cannot pass. Generate one with `openssl rand -hex 32`.
   */
  CRON_SECRET: z
    .string()
    .min(16, "CRON_SECRET is required and must be at least 16 characters"),

  /**
   * Feature 20, product analytics and error tracking (spec 0019, AC-21,
   * AC-23). Every one of these is optional in every environment, production
   * included, and there is deliberately no refinement demanding them: an
   * unset provider means observability is off and the product runs exactly
   * as before, never a boot failure. `isSentryConfigured()` and
   * `isAnalyticsConfigured()` in `src/observability/` are the two questions
   * the rest of the code asks.
   *
   * The Sentry DSN and the PostHog key are `NEXT_PUBLIC_` because the browser
   * needs them too; both identify a project, never a person. `SENTRY_ORG`,
   * `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` are read by `withSentryConfig`
   * in `next.config.ts` at build time, straight from `process.env` (a named
   * exemption: a build must not need database credentials to compile), and
   * are declared here so the schema stays the one list of everything the app
   * reads. The `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` pair
   * exists only for person deletion (AC-20).
   */
  NEXT_PUBLIC_SENTRY_DSN: optionalEnv(),
  SENTRY_ORG: optionalEnv(),
  SENTRY_PROJECT: optionalEnv(),
  SENTRY_AUTH_TOKEN: optionalEnv(),
  NEXT_PUBLIC_POSTHOG_KEY: optionalEnv(),
  NEXT_PUBLIC_POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
  POSTHOG_PERSONAL_API_KEY: optionalEnv(),
  POSTHOG_PROJECT_ID: optionalEnv(),

  /**
   * Supplied by Vercel when "automatically expose system environment
   * variables" is on, and absent everywhere else. `VERCEL_ENV` decides
   * whether the SDKs send at all (production and preview only, AC-2) and the
   * commit SHA becomes the Sentry release, so a stack trace maps to the exact
   * build that produced it.
   */
  VERCEL_ENV: optionalEnv(),
  NEXT_PUBLIC_VERCEL_ENV: optionalEnv(),
  VERCEL_GIT_COMMIT_SHA: optionalEnv(),
});

/**
 * The one cross field rule: production sends real email, so it needs the key.
 * Development and test fall back to the console transport instead (spec 0009,
 * AC-5).
 */
const serverEnvSchemaRefined = serverEnvSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && value.RESEND_API_KEY === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required in production",
    });
  }

  // The four R2 variables travel together: a production deploy with only some
  // of them set is a misconfiguration, not a partially working feature.
  if (value.NODE_ENV === "production") {
    (
      [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
      ] as const
    ).forEach((key) => {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required in production`,
        });
      }
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchemaRefined.safeParse(process.env);

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
 * One of two places in the project that reads `process.env` outside `env()`
 * (`isR2Configured` below is the other), and it has to: `env()` throws when a
 * required key is missing, which is exactly the question being asked here,
 * and Next only inlines a `NEXT_PUBLIC_` variable into the browser bundle when
 * it is written out in full like this.
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

/**
 * Are all four R2 variables set, read directly from `process.env` rather than
 * through `env()`.
 *
 * This has to skip `env()` for the same reason `isClerkConfigured` does:
 * `CLERK_SECRET_KEY` has no `.optional()`, so `env()` throws when Clerk is not
 * configured, and the download route needs an answer to "is storage
 * configured" before it has even asked whether Clerk is (spec 0011, AC-18) or
 * it crashes with a 500 instead of answering 503. Read the four keys straight
 * from `process.env` so this question never depends on the rest of the
 * schema being satisfiable.
 */
export function isR2Configured(): boolean {
  return (
    isNonEmpty(process.env.R2_ACCOUNT_ID) &&
    isNonEmpty(process.env.R2_ACCESS_KEY_ID) &&
    isNonEmpty(process.env.R2_SECRET_ACCESS_KEY) &&
    isNonEmpty(process.env.R2_BUCKET)
  );
}

function isNonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.length > 0;
}

/**
 * Is there a Resend key to send with?
 *
 * Read through `env()`, so a production process with no key has already failed
 * at parse time and never gets to ask. Outside production the answer decides
 * which transport `sendEmail()` uses (spec 0009, AC-5).
 */
export function isEmailConfigured(): boolean {
  return env().RESEND_API_KEY !== undefined;
}
