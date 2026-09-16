import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
