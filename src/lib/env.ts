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
