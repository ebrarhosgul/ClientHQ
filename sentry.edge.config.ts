/**
 * Sentry in the edge runtime (spec 0019, AC-1, AC-2): `src/proxy.ts` and any
 * route that declares `runtime = "edge"`. Loaded by `src/instrumentation.ts`
 * when `NEXT_RUNTIME` is `edge`.
 */
import * as Sentry from "@sentry/nextjs";

import { observabilityEnv } from "@/lib/observability-env";
import { sentryOptions } from "@/observability/sentry-options";

const { sentryDsn, vercelEnv, commitSha } = observabilityEnv();

Sentry.init(sentryOptions("edge", { dsn: sentryDsn, vercelEnv, commitSha }));
