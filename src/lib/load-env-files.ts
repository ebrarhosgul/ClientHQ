import { config } from "dotenv";

/**
 * Load environment files the way Next.js does, for the scripts that run outside
 * it (`drizzle.config.ts`, `scripts/*`).
 *
 * Next reads `.env.local` first and falls back to `.env`. Plain `dotenv/config`
 * reads only `.env`, so a value set in `.env.local` would reach the app and not
 * the migration tooling. That splits your configuration in half without saying
 * so, and the failure looks like a bad connection string.
 *
 * dotenv walks the list in order and does not overwrite a key it has already
 * set, so `.env.local` wins where both define the same thing. That matches Next.
 */
export function loadEnvFiles(): void {
  config({ path: [".env.local", ".env"], quiet: true });
}
