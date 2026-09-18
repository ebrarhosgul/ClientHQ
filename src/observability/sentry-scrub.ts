/**
 * What never reaches Sentry (spec 0019, AC-4).
 *
 * One function, used as both `beforeSend` and `beforeSendTransaction` in all
 * three runtimes, so the rule is written once: no request headers, cookies,
 * body or query string; nothing about the user except their id; and no
 * console breadcrumb whose message carries an email address. The `org_id`
 * tag and `user.id` survive, because they are the two values that lead an
 * issue back to the agency and person it hit without naming either.
 *
 * Pure and total: it never throws and never returns `null`, so a scrub can
 * never itself be the reason an error was dropped.
 */
import type { Breadcrumb, Event } from "@sentry/nextjs";

/** The request fields kept. Everything else on `request` is dropped. */
const KEPT_REQUEST_FIELDS = ["url", "method"] as const;

function scrubRequest(
  request: NonNullable<Event["request"]>,
): NonNullable<Event["request"]> {
  return Object.fromEntries(
    KEPT_REQUEST_FIELDS.filter((key) => request[key] !== undefined).map(
      (key) => [key, request[key]],
    ),
  );
}

function scrubUser(
  user: NonNullable<Event["user"]>,
): NonNullable<Event["user"]> {
  return user.id === undefined ? {} : { id: user.id };
}

/** A console breadcrumb that mentions an address is dropped whole. */
function keepBreadcrumb(breadcrumb: Breadcrumb): boolean {
  return !(
    breadcrumb.category === "console" &&
    typeof breadcrumb.message === "string" &&
    breadcrumb.message.includes("@")
  );
}

export function scrubEvent<TEvent extends Event>(event: TEvent): TEvent {
  return {
    ...event,
    ...(event.request === undefined
      ? {}
      : { request: scrubRequest(event.request) }),
    ...(event.user === undefined ? {} : { user: scrubUser(event.user) }),
    ...(event.breadcrumbs === undefined
      ? {}
      : { breadcrumbs: event.breadcrumbs.filter(keepBreadcrumb) }),
  };
}
