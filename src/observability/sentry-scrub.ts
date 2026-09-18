/**
 * What never reaches Sentry (spec 0019, AC-4).
 *
 * One function, used as both `beforeSend` and `beforeSendTransaction` in all
 * three runtimes, so the rule is written once: no request headers, cookies,
 * body or query string; no URL anywhere in the event carries its query or
 * hash (the SDK populates `request.url` from the raw `req.url` /
 * `location.href`, so query strings survive there even once `query_string`
 * itself is dropped); nothing about the user except their id; and no
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

/** Breadcrumb `data` keys that carry a URL and must be reduced, not dropped whole. */
const URL_DATA_KEYS = ["url", "from", "to"] as const;

/**
 * Cuts a URL or path at its first `?` or `#`, dropping the query string and
 * hash. Works on both absolute URLs (`request.url`, fetch/xhr breadcrumbs)
 * and the relative paths navigation breadcrumbs carry, so it never needs to
 * parse the value and never fails to reduce it.
 */
function stripQueryAndHash(value: string): string {
  const cutIndex = value.search(/[?#]/);
  return cutIndex === -1 ? value : value.slice(0, cutIndex);
}

function scrubRequest(
  request: NonNullable<Event["request"]>,
): NonNullable<Event["request"]> {
  const kept = Object.fromEntries(
    KEPT_REQUEST_FIELDS.filter((key) => request[key] !== undefined).map(
      (key) => [key, request[key]],
    ),
  );
  return typeof kept.url === "string"
    ? { ...kept, url: stripQueryAndHash(kept.url) }
    : kept;
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

/** Reduces any URL-shaped value a breadcrumb's `data` carries (navigation `from`/`to`, fetch/xhr `url`). */
function scrubBreadcrumbData(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.data === undefined) {
    return breadcrumb;
  }
  const data = { ...breadcrumb.data };
  for (const key of URL_DATA_KEYS) {
    if (typeof data[key] === "string") {
      data[key] = stripQueryAndHash(data[key]);
    }
  }
  return { ...breadcrumb, data };
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
      : {
          breadcrumbs: event.breadcrumbs
            .filter(keepBreadcrumb)
            .map(scrubBreadcrumbData),
        }),
  };
}
