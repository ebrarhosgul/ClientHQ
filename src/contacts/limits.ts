/**
 * The two ceilings on invitation sends, decided from `invited_at` alone (spec
 * 0009, AC-4).
 *
 * Both read a column that already exists, through the scoped accessor, with no
 * other store: the per contact cooldown looks at that contact's own stamp and
 * the per agency daily cap counts the agency's stamps inside the last day.
 * `invited_at` is written only after the provider accepts the email, so a
 * failed send never consumes either limit.
 *
 * Pure: the caller supplies `now` and the rows.
 */

export const COOLDOWN_MINUTES = 5;
export const DAILY_CAP = 50;
export const INVITE_TTL_DAYS = 7;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const DAILY_WINDOW_MS = DAY;

/**
 * Refuse when fewer than five minutes have passed since the last successful
 * send to this contact. Exactly five minutes is allowed. A contact never sent
 * to (`null`) has nothing to cool down from.
 */
export function cooldownRefuses(invitedAt: Date | null, now: Date): boolean {
  if (invitedAt === null) {
    return false;
  }

  return now.getTime() - invitedAt.getTime() < COOLDOWN_MINUTES * MINUTE;
}

/**
 * Refuse when fifty or more of the agency's contacts have an `invited_at`
 * strictly inside the last twenty four hours: the fiftieth such row refuses.
 *
 * Takes the stamps rather than a count so the boundary is decided here, in one
 * place, and a test can pin it: a stamp exactly twenty four hours old is not
 * inside the window.
 */
export function dailyCapRefuses(
  recentSends: readonly Date[],
  now: Date,
): boolean {
  const since = now.getTime() - DAILY_WINDOW_MS;
  const inside = recentSends.filter((sentAt) => sentAt.getTime() > since);

  return inside.length >= DAILY_CAP;
}

/** When a link generated now stops working. */
export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * DAY);
}
