import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second, dedicated dev server (`playwright.config.ts`'s signed in project
  // for the client portal's own suite, spec 0014) needs its own build
  // directory: `next dev` refuses to start a second instance for the same
  // project directory at all, port or not, once it finds another one's lock
  // inside `.next/`. `NEXT_DIST_DIR` is set only on that server's own `env`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `@react-pdf/renderer` is native to the Node runtime the two PDF routes
  // declare (spec 0013): bundling it would break on its dynamic requires.
  serverExternalPackages: ["@react-pdf/renderer"],
  // The two embedded Inter font files live outside the routes that read them
  // (`src/invoices/pdf/fonts/`), so tracing has to be told by hand or a
  // deployed function boots without them.
  outputFileTracingIncludes: {
    "/invoices/[id]/pdf": ["./src/invoices/pdf/fonts/**"],
    "/portal/invoices/[id]/pdf": ["./src/invoices/pdf/fonts/**"],
  },
  // PostHog traffic goes through this app's own domain (spec 0019, AC-16):
  // the browser client posts to `/ingest`, and these two rewrites forward it
  // to the EU cloud. PostHog's own paths end in a slash, so the trailing
  // slash redirect has to stay out of the way. No Sentry tunnel is
  // configured, by choice.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://eu-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
    ];
  },
};

/**
 * Source map upload (spec 0019, AC-3). The three variables are read straight
 * from `process.env`, a named exemption to the `env()` rule: `env()` parses
 * the whole schema, and a build must not need database credentials to
 * compile. Without `SENTRY_AUTH_TOKEN` the plugin skips the upload and the
 * build completes; with it, every JavaScript file and map is uploaded and the
 * maps are deleted from the deployed output afterwards (the plugin's default).
 * Turbopack, so none of the webpack only tree shaking options apply.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Only the CI and Vercel build logs need the plugin's own output.
  silent: !process.env.CI,
});
