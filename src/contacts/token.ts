/**
 * The invitation token, and the only things ever done with it (spec 0009,
 * AC-3, AC-9).
 *
 * Shape: `<contact id>.<32 random bytes, base64url>`. The contact id in front
 * is what lets the accept path fetch one row by primary key, so there is no
 * scan to brute force and no timing to read off the lookup. The secret behind
 * the dot is 256 bits from `crypto.randomBytes`; only its SHA-256 digest is
 * ever stored, and two digests are compared in constant time.
 *
 * Pure: nothing here touches the database, the clock or the network.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** 32 bytes as base64url is exactly 43 characters with no padding. */
const SECRET = /^[A-Za-z0-9_-]{43}$/u;

export const SECRET_BYTES = 32;

/** The two halves of a well formed token, and the whole for hashing. */
export type ParsedToken = {
  readonly contactId: string;
  readonly token: string;
};

/** A fresh token for this contact. Never stored; hand it to `hashToken`. */
export function generateToken(contactId: string): string {
  return `${contactId}.${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

/** The SHA-256 hex digest of the whole token, which is all the row keeps. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Take a raw query string value apart, or say it is malformed.
 *
 * `undefined` for anything that is not exactly `<uuid>.<43 base64url chars>`,
 * so nothing downstream ever queries with a shape it did not expect. The
 * contact id is lowercased, since Postgres compares uuids by value and the
 * digest must be computed on the token exactly as it was issued.
 */
export function parseToken(raw: unknown): ParsedToken | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const dot = raw.indexOf(".");

  if (dot === -1) {
    return undefined;
  }

  const contactId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);

  if (!UUID.test(contactId) || !SECRET.test(secret)) {
    return undefined;
  }

  return { contactId: contactId.toLowerCase(), token: raw };
}

/**
 * Constant time equality on two hex digests.
 *
 * Unequal lengths short circuit, which is safe: every digest here is SHA-256
 * hex, so a length mismatch means a malformed value, not a near miss.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}
