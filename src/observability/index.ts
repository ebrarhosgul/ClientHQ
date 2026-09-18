/**
 * Error tracking and the questions the rest of the app may ask about it
 * (spec 0019). Nothing outside this folder, the three Sentry config files,
 * `src/instrumentation.ts` and the error boundaries imports `@sentry/nextjs`
 * directly (key invariant 1); everything else goes through here.
 */
export {
  isAnalyticsConfigured,
  isErasureConfigured,
  isSentryConfigured,
} from "./configured";
export { logAnalyticsFailed, logErasureFailed } from "./log";
export { reportException, reportSignal, setTenantScope } from "./sentry";
export type { SignalOptions, SignalTags } from "./sentry";
