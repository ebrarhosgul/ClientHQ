/**
 * What a property is allowed to be (spec 0019, AC-9, key invariant 2).
 *
 * An id, a literal from a declared union, a boolean, an integer count or an
 * ISO date. Never a free string: a catalogue entry whose schema outputs a
 * plain `string` is a compile error in `defineEvent`, which is what makes
 * "no email, no name, no amount" a property of the type system rather than
 * of a code review. The two string shaped kinds are branded so that a plain
 * `string` cannot pass for either.
 */
import { z } from "zod";

/** A local uuid, a Clerk id or a Stripe id. Opaque on purpose. */
export const idProperty = () => z.string().min(1).brand<"AnalyticsId">();

export type Id = z.output<ReturnType<typeof idProperty>>;

/** An ISO 8601 timestamp, as `Date.prototype.toISOString` writes one. */
export const isoDateProperty = () =>
  z.iso.datetime().brand<"AnalyticsIsoDate">();

export type IsoDate = z.output<ReturnType<typeof isoDateProperty>>;

export const countProperty = () => z.number().int().nonnegative();

export const flagProperty = () => z.boolean();

/** One of a declared, closed set of words. */
export const literalProperty = <const T extends readonly [string, ...string[]]>(
  values: T,
) => z.enum(values);

/**
 * The subscription statuses analytics knows how to name. The local column is
 * a plain string so a status Stripe invents tomorrow is stored rather than
 * refused (spec 0002); here it folds into `other`, so the property stays a
 * literal from a closed set and the event is never dropped for it.
 */
export const SUBSCRIPTION_STATUS_PROPERTY = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "other",
] as const;

export type SubscriptionStatusProperty =
  (typeof SUBSCRIPTION_STATUS_PROPERTY)[number];

export function subscriptionStatusProperty(
  status: string | undefined,
): SubscriptionStatusProperty {
  if (status === undefined) {
    return "none";
  }

  return (SUBSCRIPTION_STATUS_PROPERTY as readonly string[]).includes(status)
    ? (status as SubscriptionStatusProperty)
    : "other";
}

export const MEMBERSHIP_ROLE_PROPERTY = ["admin", "member"] as const;

/** A shape whose every value is one of the allowed kinds, and never `string`. */
export type NoPlainString<T> = {
  readonly [K in keyof T]: string extends T[K] ? never : T[K];
};

/** The properties a caller hands `track`: the schema's input side. */
export type PropertiesOf<Schema extends z.ZodObject> = z.input<Schema>;

/**
 * Declare one event or property set. The conditional constraint is the
 * compile time rule: a schema that outputs a plain `string` anywhere does
 * not satisfy `NoPlainString`, and the call fails to typecheck.
 */
export function defineProperties<Schema extends z.ZodObject>(
  schema: Schema &
    (z.output<Schema> extends NoPlainString<z.output<Schema>>
      ? unknown
      : { readonly __error: "a property may not be a plain string" }),
): Schema {
  return schema;
}
