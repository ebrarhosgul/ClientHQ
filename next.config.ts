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
};

export default nextConfig;
