/**
 * Where events go (spec 0019, AC-21, AC-22). Three sinks share one shape:
 * the real one over `posthog-node`, the silent one for a process with no
 * key or under test, and a recording one for unit tests to assert on.
 *
 * The only file in the project that imports `posthog-node` (key invariant
 * 1). Every message a sink receives has already been through the client's
 * schema parse, so a sink never sees a property the catalogue did not
 * declare.
 */
import { PostHog } from "posthog-node";

export type CaptureMessage = {
  readonly distinctId: string;
  readonly event: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

export type IdentifyMessage = {
  readonly distinctId: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

export type GroupIdentifyMessage = {
  readonly groupType: string;
  readonly groupKey: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

export type AnalyticsSink = {
  readonly capture: (message: CaptureMessage) => void;
  readonly identify: (message: IdentifyMessage) => void;
  readonly groupIdentify: (message: GroupIdentifyMessage) => void;
  /**
   * Delete the person and their events. Resolves when the provider has
   * confirmed it, or when there was no such person, which counts as done
   * (the sweep re issues this, so it has to be idempotent).
   */
  readonly deletePerson: (distinctId: string) => Promise<void>;
  /** Send everything queued. Never rejects with a caller in the way. */
  readonly flush: () => Promise<void>;
};

export const noopSink: AnalyticsSink = {
  capture: () => undefined,
  identify: () => undefined,
  groupIdentify: () => undefined,
  deletePerson: async () => undefined,
  flush: async () => undefined,
};

export type RecordedCall =
  | { readonly kind: "capture"; readonly message: CaptureMessage }
  | { readonly kind: "identify"; readonly message: IdentifyMessage }
  | { readonly kind: "groupIdentify"; readonly message: GroupIdentifyMessage }
  | { readonly kind: "deletePerson"; readonly distinctId: string }
  | { readonly kind: "flush" };

export type RecordingSink = AnalyticsSink & {
  readonly calls: readonly RecordedCall[];
  /** Forget every recorded call, for a `beforeEach`. */
  readonly reset: () => void;
};

/**
 * A sink for tests: records every call in order. `failing` makes every
 * call throw, which is how the "a provider error never reaches the caller"
 * scenarios are written.
 */
export function recordingSink(options?: {
  readonly failing?: boolean;
}): RecordingSink {
  const calls: RecordedCall[] = [];

  const record = (call: RecordedCall): void => {
    calls.push(call);

    if (options?.failing === true) {
      throw new Error("provider down");
    }
  };

  return {
    calls,
    reset: () => {
      calls.splice(0, calls.length);
    },
    capture: (message) => record({ kind: "capture", message }),
    identify: (message) => record({ kind: "identify", message }),
    groupIdentify: (message) => record({ kind: "groupIdentify", message }),
    deletePerson: async (distinctId) =>
      record({ kind: "deletePerson", distinctId }),
    flush: async () => record({ kind: "flush" }),
  };
}

export type PosthogSinkOptions = {
  readonly key: string;
  /** The ingestion host, `https://eu.i.posthog.com` by default. */
  readonly host: string;
  /** The private pair for person deletion; either missing means no erasure. */
  readonly personalApiKey: string | undefined;
  readonly projectId: string | undefined;
  readonly fetch?: typeof fetch;
};

/**
 * The private API lives on the app host, not the ingestion host:
 * `eu.i.posthog.com` takes events, `eu.posthog.com` answers `/api/`.
 */
export function apiHostFor(ingestHost: string): string {
  return ingestHost.replace(
    /\/\/([a-z]+)\.i\.posthog\.com/,
    "//$1.posthog.com",
  );
}

/** The two requests person deletion takes: find the person, then delete it. */
export async function deletePersonThroughApi(
  options: Pick<PosthogSinkOptions, "host" | "personalApiKey" | "projectId">,
  distinctId: string,
  doFetch: typeof fetch,
): Promise<void> {
  if (options.personalApiKey === undefined || options.projectId === undefined) {
    throw new Error("analytics_unconfigured");
  }

  const base = `${apiHostFor(options.host)}/api/projects/${encodeURIComponent(options.projectId)}/persons/`;
  const headers = { Authorization: `Bearer ${options.personalApiKey}` };

  const lookup = await doFetch(
    `${base}?distinct_id=${encodeURIComponent(distinctId)}`,
    { headers },
  );

  if (!lookup.ok) {
    throw new Error(`person lookup failed: ${lookup.status}`);
  }

  const body = (await lookup.json()) as {
    readonly results?: readonly { readonly id?: number | string }[];
  };
  const personId = body.results?.[0]?.id;

  if (personId === undefined) {
    // Already gone, or never existed: erasure is complete either way.
    return;
  }

  const deletion = await doFetch(
    `${base}${encodeURIComponent(String(personId))}/?delete_events=true`,
    { method: "DELETE", headers },
  );

  if (!deletion.ok && deletion.status !== 404) {
    throw new Error(`person deletion failed: ${deletion.status}`);
  }
}

export function posthogSink(options: PosthogSinkOptions): AnalyticsSink {
  const client = new PostHog(options.key, {
    host: options.host,
    // A serverless function is short lived: send on the first flush rather
    // than waiting for a batch to fill or a timer to fire.
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
    requestTimeout: 3000,
  });
  const doFetch = options.fetch ?? fetch;

  return {
    capture: ({ distinctId, event, properties }) => {
      client.capture({ distinctId, event, properties: { ...properties } });
    },
    identify: ({ distinctId, properties }) => {
      client.identify({ distinctId, properties: { ...properties } });
    },
    groupIdentify: ({ groupType, groupKey, properties }) => {
      client.groupIdentify({
        groupType,
        groupKey,
        properties: { ...properties },
      });
    },
    deletePerson: (distinctId) =>
      deletePersonThroughApi(options, distinctId, doFetch),
    flush: () => client.flush(),
  };
}
