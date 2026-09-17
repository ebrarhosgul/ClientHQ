import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The whole gate on `/api/cron/daily` (spec 0017, AC-1). No session, no
 * tenant, no role: whoever holds `CRON_SECRET` may run every sweep across
 * every agency.
 *
 * Both sides are hashed to a fixed length before `timingSafeEqual`, which
 * throws on a length mismatch rather than answering false: a wrong-length
 * token would otherwise leak its length through a thrown exception versus a
 * clean comparison, which is exactly what hashing first avoids.
 */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) {
    return false;
  }

  const token = header.slice("Bearer ".length);

  return timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(secret).digest(),
  );
}
