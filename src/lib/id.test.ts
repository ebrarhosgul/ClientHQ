/**
 * @vitest-environment node
 *
 * covers: spec 0002 Value sourcing, row "Any insert, `id`" (every row's id is a
 * uuid v7 minted in the application, sortable in insertion order)
 *
 * The layout matters more than it looks. If the version nibble were wrong the
 * `uuid` column would still take the value, and the ids would still be unique,
 * so nothing would fail until someone tried to read a timestamp out of one. If
 * the timestamp bytes were wrong, ids would scatter across the primary key
 * index instead of landing at its right edge, and that shows up as a slow
 * database months later rather than as a broken test. Both are pinned here.
 *
 * No database and no clock of its own: `uuidV7Bytes` takes the millisecond and
 * the random bytes as arguments, which is what makes the layout testable at
 * all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatUuid, newId, uuidV7Bytes } from "./id";

/** The canonical form, with version 7 and the RFC 9562 variant bits pinned. */
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Ten distinct random bytes, so a misplaced one is visible in the assertion. */
const random = (): Uint8Array =>
  Uint8Array.from([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9]);

/** Read the 48 bit big endian millisecond count back out of the first six bytes. */
const timestampOf = (bytes: Uint8Array): number =>
  bytes.slice(0, 6).reduce((total, byte) => total * 256 + byte, 0);

/** The same, from a formatted uuid string. */
const timestampOfString = (uuid: string): number =>
  parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);

describe("uuidV7Bytes", () => {
  it("refuses fewer than ten random bytes, rather than quietly reading undefined", () => {
    expect(() => uuidV7Bytes(0, new Uint8Array(9))).toThrow(
      /at least 10 random bytes/,
    );
  });

  it("makes exactly sixteen bytes", () => {
    expect(uuidV7Bytes(Date.now(), random())).toHaveLength(16);
  });

  it("writes the millisecond count into the first six bytes, big endian", () => {
    // Above 2^32, so the high and low halves of the split are both exercised.
    const ms = 1_780_000_000_000;
    expect(timestampOf(uuidV7Bytes(ms, random()))).toBe(ms);
  });

  it("still round trips a small millisecond count, where the high half is zero", () => {
    expect(timestampOf(uuidV7Bytes(1, random()))).toBe(1);
  });

  it("round trips the largest millisecond a 48 bit field can hold", () => {
    const ms = 2 ** 48 - 1;
    expect(timestampOf(uuidV7Bytes(ms, random()))).toBe(ms);
  });

  it("puts version 7 in the high nibble of byte six", () => {
    expect(uuidV7Bytes(0, random())[6] & 0xf0).toBe(0x70);
  });

  it("puts the RFC 9562 variant, binary 10, in the top two bits of byte eight", () => {
    expect(uuidV7Bytes(0, random())[8] & 0xc0).toBe(0x80);
  });

  it("keeps the random bytes that the version and variant do not overwrite", () => {
    const bytes = uuidV7Bytes(0, random());
    expect(bytes[7]).toBe(0xa1);
    expect([...bytes.slice(9)]).toEqual([
      0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
    ]);
  });

  it("keeps the low bits of the two bytes it does share with the random ones", () => {
    const bytes = uuidV7Bytes(0, random());
    expect(bytes[6] & 0x0f).toBe(0xa0 & 0x0f);
    expect(bytes[8] & 0x3f).toBe(0xa2 & 0x3f);
  });

  it("floors a fractional millisecond instead of letting it corrupt a byte", () => {
    expect(timestampOf(uuidV7Bytes(1_780_000_000_000.9, random()))).toBe(
      1_780_000_000_000,
    );
  });

  it("clamps a negative millisecond to zero", () => {
    expect(timestampOf(uuidV7Bytes(-1, random()))).toBe(0);
  });

  it("uses only the first ten random bytes when given more", () => {
    const long = new Uint8Array(16);
    long.set(random());
    expect([...uuidV7Bytes(0, long)]).toEqual([...uuidV7Bytes(0, random())]);
  });
});

describe("formatUuid", () => {
  it("groups the bytes 8-4-4-4-12 as lowercase hex", () => {
    const bytes = Uint8Array.from([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x7c, 0xde, 0x8f, 0x01, 0x23, 0x45,
      0x67, 0x89, 0xab, 0xcd,
    ]);
    expect(formatUuid(bytes)).toBe("01234567-89ab-7cde-8f01-23456789abcd");
  });

  it("pads a byte below sixteen with its leading zero", () => {
    expect(formatUuid(new Uint8Array(16))).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });
});

describe("newId", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes a canonical uuid with version 7 and the right variant bits", () => {
    expect(newId()).toMatch(UUID_V7);
  });

  it("makes a different id every time", () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
  });

  it("stamps the current time into the id", () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-07T12:00:00.000Z");
    vi.setSystemTime(now);
    expect(timestampOfString(newId())).toBe(now.getTime());
  });

  it("sorts ids from later milliseconds after earlier ones, so inserts land at the right edge of the index", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00.000Z"));
    const first = newId();
    vi.advanceTimersByTime(1);
    const second = newId();
    vi.advanceTimersByTime(1000);
    const third = newId();

    expect([third, first, second].sort()).toEqual([first, second, third]);
  });

  it("never goes backwards in time across calls, whatever the random bits do", () => {
    // Within one millisecond the random bits decide the order, so two ids made
    // back to back are not guaranteed to sort in call order. The timestamp
    // prefix is the part that is: it never decreases.
    const stamps = Array.from({ length: 200 }, () =>
      timestampOfString(newId()),
    );
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });
});
