/**
 * Sentry in the Node runtime (spec 0019, AC-1, AC-2), loaded by
 * `src/instrumentation.ts`'s `register()` when `NEXT_RUNTIME` is `nodejs`.
 *
 * Everything worth reading is in `src/observability/sentry-options.ts`; this
 * file only names the runtime and hands over the environment.
 */
import * as Sentry from "@sentry/nextjs";

import { observabilityEnv } from "@/lib/observability-env";
import { sentryOptions } from "@/observability/sentry-options";

const { sentryDsn, vercelEnv, commitSha } = observabilityEnv();

Sentry.init(sentryOptions("node", { dsn: sentryDsn, vercelEnv, commitSha }));
