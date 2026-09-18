/**
 * The event catalogue (spec 0019, AC-9, AC-11, AC-12, AC-13): every product
 * event the server may send, each with a Zod schema for its extra properties.
 *
 * `org_id` is not declared here because `track` stamps it on every event
 * from its own argument, never from a property; the schema is what is extra.
 * The funnel spine (onboarding started, agency created, first invoice
 * issued, checkout started, subscription started) is what the dashboards are
 * built on, and every one of those fires on the server where the truth is.
 *
 * Who an event belongs to is declared with it. A Clerk user id gets a person
 * profile; an agency or a client contact never does (`$process_person_profile`
 * is false for them), so no person record ever exists for a contact.
 */
import { z } from "zod";

import {
  countProperty,
  defineProperties,
  flagProperty,
  idProperty,
  isoDateProperty,
  literalProperty,
  MEMBERSHIP_ROLE_PROPERTY,
  SUBSCRIPTION_STATUS_PROPERTY,
} from "./properties";

/** Who an event is about, and whether PostHog may keep a person for them. */
export type DistinctIdKind = "user" | "org" | "client";

type EventDefinition<Schema extends z.ZodObject> = {
  readonly schema: Schema;
  /** The only kind of subject this event may be sent for. */
  readonly subject: DistinctIdKind;
};

function defineEvent<Schema extends z.ZodObject>(
  subject: DistinctIdKind,
  schema: Parameters<typeof defineProperties<Schema>>[0],
): EventDefinition<Schema> {
  return { subject, schema: defineProperties<Schema>(schema) };
}

const none = z.object({});

export const EVENTS = {
  // The funnel spine.
  "onboarding.started": defineEvent("user", none),
  "agency.created": defineEvent("user", none),
  "invoice.issued": defineEvent(
    "user",
    z.object({ invoice_id: idProperty(), is_first: flagProperty() }),
  ),
  "checkout.started": defineEvent(
    "user",
    z.object({
      subscription_status: literalProperty(SUBSCRIPTION_STATUS_PROPERTY),
    }),
  ),
  "subscription.started": defineEvent(
    "org",
    z.object({
      subscribed_at: isoDateProperty(),
      subscription_status: literalProperty(SUBSCRIPTION_STATUS_PROPERTY),
    }),
  ),
  "subscription.changed": defineEvent(
    "org",
    z.object({
      status: literalProperty(SUBSCRIPTION_STATUS_PROPERTY),
      subscription_status: literalProperty(SUBSCRIPTION_STATUS_PROPERTY),
    }),
  ),

  // The rest of the agency side.
  "client.created": defineEvent("user", z.object({ client_id: idProperty() })),
  "project.created": defineEvent(
    "user",
    z.object({ project_id: idProperty(), client_id: idProperty() }),
  ),
  "deliverable.uploaded": defineEvent(
    "user",
    z.object({ deliverable_id: idProperty(), project_id: idProperty() }),
  ),
  "deliverable.shared": defineEvent(
    "user",
    z.object({ deliverable_id: idProperty() }),
  ),
  "contact.invited": defineEvent("user", z.object({ client_id: idProperty() })),
  "contact.accepted": defineEvent(
    "client",
    z.object({ client_id: idProperty() }),
  ),
  "team_member.invited": defineEvent(
    "user",
    z.object({ role: literalProperty(MEMBERSHIP_ROLE_PROPERTY) }),
  ),
  "team_member.joined": defineEvent(
    "user",
    z.object({ role: literalProperty(MEMBERSHIP_ROLE_PROPERTY) }),
  ),
  "invoice.paid": defineEvent("user", z.object({ invoice_id: idProperty() })),
  "invoice.voided": defineEvent("user", z.object({ invoice_id: idProperty() })),
  "invoice.pdf_downloaded": defineEvent(
    "user",
    z.object({ invoice_id: idProperty() }),
  ),

  // The portal: a client, never a person.
  "portal.viewed": defineEvent(
    "client",
    z.object({
      client_id: idProperty(),
      path: literalProperty([
        "/portal",
        "/portal/projects",
        "/portal/projects/[id]",
        "/portal/invoices",
        "/portal/invoices/[id]",
        "/portal/files",
      ]),
    }),
  ),
  "portal.invoice_viewed": defineEvent(
    "client",
    z.object({ client_id: idProperty(), invoice_id: idProperty() }),
  ),
  "portal.file_downloaded": defineEvent(
    "client",
    z.object({ client_id: idProperty(), deliverable_id: idProperty() }),
  ),
} as const;

export type EventName = keyof typeof EVENTS;

export type EventSchema<E extends EventName> = (typeof EVENTS)[E]["schema"];

/** The properties a caller passes for one event: the schema's input side. */
export type EventProperties<E extends EventName> = z.input<EventSchema<E>>;

export const EVENT_NAMES = Object.keys(EVENTS) as readonly EventName[];

/** The whole allowed person property set (AC-13). */
export const PERSON_PROPERTIES = defineProperties(
  z.object({
    role: literalProperty(MEMBERSHIP_ROLE_PROPERTY),
    created_at: isoDateProperty(),
  }),
);

export type PersonProperties = z.input<typeof PERSON_PROPERTIES>;

/** The whole allowed agency group property set (AC-13). */
export const AGENCY_PROPERTIES = defineProperties(
  z.object({
    subscription_status: literalProperty(SUBSCRIPTION_STATUS_PROPERTY),
    trial_ends_at: isoDateProperty().optional(),
    subscribed_at: isoDateProperty().optional(),
    created_at: isoDateProperty(),
    team_size: countProperty(),
  }),
);

export type AgencyProperties = z.input<typeof AGENCY_PROPERTIES>;

/** The one group type this product declares. */
export const AGENCY_GROUP_TYPE = "agency";
