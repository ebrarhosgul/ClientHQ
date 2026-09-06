/**
 * Primary key generation.
 *
 * Every row's `id` is a uuid v7 made here, never by the database (spec 0002,
 * Value sourcing). A v7 uuid starts with a millisecond timestamp, so ids made
 * one after another sort in insertion order and land at the right edge of the
 * primary key index instead of scattering across it the way a v4 does.
 *
 * Layout, per RFC 9562:
 *
 *   48 bits  unix time in milliseconds
 *    4 bits  version (7)
 *   12 bits  random
 *    2 bits  variant (10)
 *   62 bits  random
 */

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => HEX[byte >> 4] + HEX[byte & 0x0f]).join(
    "",
  );
}

/** Build the 16 bytes of a v7 uuid from a timestamp and 10 random bytes. */
export function uuidV7Bytes(
  timestampMs: number,
  random: Uint8Array,
): Uint8Array {
  if (random.length < 10) {
    throw new Error("uuidV7Bytes needs at least 10 random bytes");
  }

  const ms = Math.max(0, Math.floor(timestampMs));
  // Split the 48 bit millisecond count into a 16 bit high part and a 32 bit
  // low part. Both fit a double exactly, so no BigInt is needed.
  const high = Math.floor(ms / 0x100000000);
  const low = ms % 0x100000000;

  return Uint8Array.from([
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
    // Version 7 in the high nibble, four random bits in the low one.
    0x70 | (random[0] & 0x0f),
    random[1],
    // Variant 10xx in the top two bits.
    0x80 | (random[2] & 0x3f),
    random[3],
    random[4],
    random[5],
    random[6],
    random[7],
    random[8],
    random[9],
  ]);
}

/** Format 16 bytes as the canonical 8-4-4-4-12 uuid string. */
export function formatUuid(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A fresh uuid v7 for a new row.
 *
 * Lives here rather than in the schema so the seed, the tests and later the
 * data access layer all mint ids the same way.
 */
export function newId(): string {
  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);
  return formatUuid(uuidV7Bytes(Date.now(), random));
}
