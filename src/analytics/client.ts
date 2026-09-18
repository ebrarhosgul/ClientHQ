/**
 * The analytics client (spec 0019, AC-9, AC-10, AC-12, AC-13, AC-20,
 * AC-21, AC-22).
 *
 * Five calls, and every one keeps two promises: it never throws into its
 * caller, and it is a no op when there is no key or under test. A property
 * set is parsed against its catalogue schema before it leaves; one that does
 * not parse is dropped with an `analytics.failed` line rather than sent, so
 * a wrong shape can never leak something the catalogue did not declare.
 *
 * Nothing sends inline. Each call queues on the sink and schedules one
 * flush with `after()`, so the response never waits on PostHog. Outside a
 * request (a unit test, a script) `after()` throws, and the flush runs right
 * away instead.
 */
import { observabilityEnv } from "@/lib/observability-env";
import { isAnalyticsConfigured, logAnalyticsFailed } from "@/observability";

import { afterResponse } from "./after-response";
import {
  AGENCY_GROUP_TYPE,
  AGENCY_PROPERTIES,
  EVENTS,
  PERSON_PROPERTIES,
  type AgencyProperties,
  type EventName,
  type EventProperties,
  type PersonProperties,
} from "./events";
import { noopSink, posthogSink, type AnalyticsSink } from "./sink";

/**
 * Who an event is about. Only a Clerk user gets a person profile; an agency
 * (`org:<id>`) and a client (`client:<id>`) are sent with
 * `$process_person_profile: false`, so no person record ever exists for
 * them (AC-12).
 */
export type DistinctId =
  | { readonly kind: "user"; readonly clerkUserId: string }
  | { readonly kind: "org"; readonly orgId: string }
  | { readonly kind: "client"; readonly clientId: string };

export type TrackInput<E extends EventName> = {
  readonly distinctId: DistinctId;
  /**
   * Stamped as `org_id` on every event. Optional only for the one event that
   * happens before an agency exists, `onboarding.started`.
   */
  readonly orgId: string | undefined;
} & (Record<string, never> extends EventProperties<E>
  ? { readonly properties?: EventProperties<E> }
  : { readonly properties: EventProperties<E> });

export type Analytics = {
  /**
   * False for the silent client (no key, or under test). Callers that would
   * read the database only to build properties check this first, so a
   * process with analytics off never pays for reads nobody receives.
   */
  readonly enabled: boolean;
  readonly track: <E extends EventName>(event: E, input: TrackInput<E>) => void;
  readonly identify: (
    clerkUserId: string,
    properties: PersonProperties,
  ) => void;
  readonly groupIdentify: (orgId: string, properties: AgencyProperties) => void;
  readonly deletePerson: (clerkUserId: string) => Promise<boolean>;
  readonly flush: () => Promise<void>;
};

export function distinctIdString(distinctId: DistinctId): string {
  switch (distinctId.kind) {
    case "user":
      return distinctId.clerkUserId;
    case "org":
      return `org:${distinctId.orgId}`;
    case "client":
      return `client:${distinctId.clientId}`;
  }
}

/**
 * Run the flush once the response is out; anywhere without a response the
 * flush simply runs now, and either way a rejection is swallowed after one
 * log line.
 */
function scheduleFlush(sink: AnalyticsSink): void {
  afterResponse(() =>
    sink.flush().catch((thrown: unknown) => {
      logAnalyticsFailed("flush", thrown);
    }),
  );
}

export function createAnalytics({
  sink,
  enabled = true,
}: {
  readonly sink: AnalyticsSink;
  readonly enabled?: boolean;
}): Analytics {
  const attempt = (name: string, fn: () => void): void => {
    try {
      fn();
      scheduleFlush(sink);
    } catch (thrown) {
      logAnalyticsFailed(name, thrown);
    }
  };

  return {
    enabled,
    track: (event, input) => {
      attempt(event, () => {
        const definition = EVENTS[event];

        if (definition.subject !== input.distinctId.kind) {
          throw new TypeError(
            `${event} is a ${definition.subject} event, sent for a ${input.distinctId.kind}`,
          );
        }

        const parsed = definition.schema.safeParse(input.properties ?? {});

        if (!parsed.success) {
          throw new TypeError(`properties of ${event} do not match its schema`);
        }

        sink.capture({
          distinctId: distinctIdString(input.distinctId),
          event,
          properties: {
            ...parsed.data,
            ...(input.orgId === undefined ? {} : { org_id: input.orgId }),
            ...(input.distinctId.kind === "user"
              ? {}
              : { $process_person_profile: false }),
          },
        });
      });
    },

    identify: (clerkUserId, properties) => {
      attempt("identify", () => {
        sink.identify({
          distinctId: clerkUserId,
          properties: PERSON_PROPERTIES.parse(properties),
        });
      });
    },

    groupIdentify: (orgId, properties) => {
      attempt("groupIdentify", () => {
        sink.groupIdentify({
          groupType: AGENCY_GROUP_TYPE,
          groupKey: orgId,
          properties: AGENCY_PROPERTIES.parse(properties),
        });
      });
    },

    deletePerson: async (clerkUserId) => {
      try {
        await sink.deletePerson(clerkUserId);

        return true;
      } catch (thrown) {
        logAnalyticsFailed("deletePerson", thrown);

        return false;
      }
    },

    flush: () =>
      sink.flush().catch((thrown: unknown) => {
        logAnalyticsFailed("flush", thrown);
      }),
  };
}

/**
 * The sink this process sends to. Silent under test whatever the keys say
 * (AC-22), silent without a key (AC-21), otherwise PostHog EU.
 */
function sinkFromEnvironment(): AnalyticsSink {
  const {
    nodeEnv,
    posthogKey,
    posthogHost,
    posthogPersonalApiKey,
    posthogProjectId,
  } = observabilityEnv();

  if (
    nodeEnv === "test" ||
    !isAnalyticsConfigured() ||
    posthogKey === undefined
  ) {
    return noopSink;
  }

  return posthogSink({
    key: posthogKey,
    host: posthogHost,
    personalApiKey: posthogPersonalApiKey,
    projectId: posthogProjectId,
  });
}

let instance: Analytics | undefined;

/** The module's default client, built from the environment on first use. */
export function analytics(): Analytics {
  if (instance === undefined) {
    const sink = sinkFromEnvironment();

    instance = createAnalytics({ sink, enabled: sink !== noopSink });
  }

  return instance;
}

/** Test seam: forget the default instance so the next call rebuilds it. */
export function resetAnalyticsForTests(): void {
  instance = undefined;
}
