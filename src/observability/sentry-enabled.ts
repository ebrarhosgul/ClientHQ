/**
 * Whether Sentry sends at all, decided from two values and nothing else
 * (spec 0019, AC-2).
 *
 * Pure so the five cases can be pinned by a test: production and preview
 * send when a DSN exists; development, test and an unset `VERCEL_ENV` (every
 * laptop, every CI runner) never make a network call. `NODE_ENV=test` is not
 * consulted here because it never needs to be: the test runner has no
 * `VERCEL_ENV`, so it lands in the last case.
 */

/** The two Vercel environments the SDKs are allowed to send from. */
const SENDING_ENVIRONMENTS = ["production", "preview"] as const;

export type SentryEnvironment = (typeof SENDING_ENVIRONMENTS)[number];

export type SentryEnabledInput = {
  readonly dsn: string | undefined;
  /** `VERCEL_ENV` on the server, `NEXT_PUBLIC_VERCEL_ENV` in the browser. */
  readonly vercelEnv: string | undefined;
};

export function isSendingEnvironment(
  vercelEnv: string | undefined,
): vercelEnv is SentryEnvironment {
  return (
    vercelEnv !== undefined &&
    (SENDING_ENVIRONMENTS as readonly string[]).includes(vercelEnv)
  );
}

export function sentryEnabled({ dsn, vercelEnv }: SentryEnabledInput): boolean {
  return dsn !== undefined && dsn.length > 0 && isSendingEnvironment(vercelEnv);
}

/**
 * The `environment` tag. Outside production and preview the SDK is disabled
 * anyway, so the value only ever matters for those two, but it is still set
 * honestly for a `debug` session on a laptop.
 */
export function sentryEnvironment(vercelEnv: string | undefined): string {
  return vercelEnv ?? "development";
}
