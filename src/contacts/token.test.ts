/**
 * @vitest-environment node
 *
 * covers: spec 0009 AC-3, AC-9, AC-11
 */
import { describe, expect, it } from "vitest";

import { digestsMatch, generateToken, hashToken, parseToken } from "./token";

const CONTACT_ID = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";

describe("generateToken", () => {
  it("is the contact id, a dot, and 43 base64url characters", () => {
    const token = generateToken(CONTACT_ID);

    expect(token).toMatch(
      new RegExp(`^${CONTACT_ID}\\.[A-Za-z0-9_-]{43}$`, "u"),
    );
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 50 }, () => generateToken(CONTACT_ID)),
    );

    expect(seen.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is the SHA-256 hex digest of the whole token", () => {
    const token = `${CONTACT_ID}.${"a".repeat(43)}`;

    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/u);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(`${token}b`));
    // The id is part of what is hashed, so the same secret on another contact
    // is a different digest.
    expect(hashToken(token)).not.toBe(
      hashToken(`1192f3a4-5b6c-7d8e-9f01-23456789abcd.${"a".repeat(43)}`),
    );
  });
});

describe("parseToken", () => {
  it("takes a generated token apart", () => {
    const token = generateToken(CONTACT_ID);

    expect(parseToken(token)).toEqual({ contactId: CONTACT_ID, token });
  });

  it("lowercases the contact id and keeps the token as issued", () => {
    const secret = "A".repeat(43);
    const raw = `${CONTACT_ID.toUpperCase()}.${secret}`;

    expect(parseToken(raw)).toEqual({ contactId: CONTACT_ID, token: raw });
  });

  it.each([
    ["not a string", 42],
    ["undefined", undefined],
    ["empty", ""],
    ["no dot", `${CONTACT_ID}${"a".repeat(43)}`],
    ["not a uuid", `nope.${"a".repeat(43)}`],
    ["short secret", `${CONTACT_ID}.${"a".repeat(42)}`],
    ["long secret", `${CONTACT_ID}.${"a".repeat(44)}`],
    ["padding", `${CONTACT_ID}.${"a".repeat(42)}=`],
    ["standard base64 chars", `${CONTACT_ID}.${"a".repeat(41)}+/`],
    ["two dots", `${CONTACT_ID}.${"a".repeat(43)}.x`],
  ])("refuses a malformed token: %s", (_label, raw) => {
    expect(parseToken(raw)).toBeUndefined();
  });
});

describe("digestsMatch", () => {
  it("matches equal digests and nothing else", () => {
    const a = hashToken("one");
    const b = hashToken("two");

    expect(digestsMatch(a, a)).toBe(true);
    expect(digestsMatch(a, b)).toBe(false);
    expect(digestsMatch(a, a.slice(1))).toBe(false);
    expect(digestsMatch("", "")).toBe(true);
  });
});
