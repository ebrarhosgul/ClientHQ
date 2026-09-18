/**
 * The agency's group properties and the person's properties, read from the
 * mirror by explicit id (spec 0019, AC-13). Shared by every path that
 * changes what they say: agency creation, a subscription transition, a
 * membership insert or removal, a role change.
 *
 * Every caller awaits these after its own write already committed (key
 * invariant 4, AC-21), so a database blip on this read must never surface as
 * the action's failure: `identifyAgency` and `identifyPerson` swallow their
 * own read and log `analytics.failed` rather than throw, the same promise
 * the analytics client keeps for the provider call underneath.
 *
 * Deliberately not re exported from `src/analytics/index.ts`: this file
 * reaches into the tenant layer, and the tenant layer's action wrapper
 * imports the barrel, so exporting it there would close a cycle.
 */
import {
  agencyAnalyticsSnapshot,
  personCreatedAt,
  type Executor,
} from "@/db/tenant";
import { logAnalyticsFailed } from "@/observability";

import { analytics } from "./client";
import type { AgencyProperties, PersonProperties } from "./events";
import { subscriptionStatusProperty } from "./properties";

function isoOrUndefined(date: Date | null | undefined): string | undefined {
  return date == null ? undefined : date.toISOString();
}

export type AgencyGroupOverrides = {
  /** The Stripe subscription in memory; its status and trial end win over the row. */
  readonly subscription?: {
    readonly status: string;
    readonly trial_end?: Date | null | undefined;
  };
  readonly subscribedAt?: Date | undefined;
};

/** Undefined for an organization the mirror does not hold. */
export async function agencyGroupProperties(
  orgId: string,
  overrides: AgencyGroupOverrides = {},
  executor?: Executor,
): Promise<AgencyProperties | undefined> {
  if (!analytics().enabled) {
    return undefined;
  }

  const snapshot = await agencyAnalyticsSnapshot(orgId, executor);

  if (snapshot === undefined) {
    return undefined;
  }

  return {
    subscription_status: subscriptionStatusProperty(
      overrides.subscription?.status ?? snapshot.subscriptionStatus,
    ),
    trial_ends_at: isoOrUndefined(overrides.subscription?.trial_end),
    subscribed_at: isoOrUndefined(overrides.subscribedAt),
    created_at: snapshot.createdAt.toISOString(),
    team_size: snapshot.teamSize,
  };
}

/** Read and send the agency's group properties in one go. Never throws (AC-21). */
export async function identifyAgency(
  orgId: string,
  overrides: AgencyGroupOverrides = {},
  executor?: Executor,
): Promise<void> {
  try {
    const properties = await agencyGroupProperties(orgId, overrides, executor);

    if (properties !== undefined) {
      analytics().groupIdentify(orgId, properties);
    }
  } catch (thrown) {
    logAnalyticsFailed("groupIdentify", thrown);
  }
}

/** Read and send a person's properties: their role and when they joined. Never throws (AC-21). */
export async function identifyPerson(
  person: {
    readonly clerkUserId: string;
    readonly userId: string;
    readonly role: PersonProperties["role"];
  },
  executor?: Executor,
): Promise<void> {
  if (!analytics().enabled) {
    return;
  }

  try {
    const createdAt = await personCreatedAt(person.userId, executor);

    if (createdAt !== undefined) {
      analytics().identify(person.clerkUserId, {
        role: person.role,
        created_at: createdAt.toISOString(),
      });
    }
  } catch (thrown) {
    logAnalyticsFailed("identify", thrown);
  }
}
