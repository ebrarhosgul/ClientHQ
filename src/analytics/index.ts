/**
 * Product analytics (spec 0019). Nothing outside this folder imports
 * `posthog-node` or `posthog-js` (key invariant 1); the rest of the server
 * reaches PostHog through `analytics()` and the catalogue in `events.ts`.
 */
export { afterResponse } from "./after-response";
export {
  analytics,
  createAnalytics,
  distinctIdString,
  type Analytics,
  type DistinctId,
  type TrackInput,
} from "./client";
export {
  AGENCY_GROUP_TYPE,
  EVENT_NAMES,
  EVENTS,
  type AgencyProperties,
  type EventName,
  type EventProperties,
  type PersonProperties,
} from "./events";
export {
  subscriptionStatusProperty,
  type SubscriptionStatusProperty,
} from "./properties";
export { noopSink, recordingSink, type AnalyticsSink } from "./sink";
