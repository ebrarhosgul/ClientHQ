/**
 * @vitest-environment node
 *
 * covers: spec 0002 AC-9 (the seed refuses to write to a database that is not
 * local and not explicitly named)
 *
 * This is the guard between a production connection string in the wrong
 * terminal and every row in it being overwritten by fake data. The seed writes
 * with "insert, or update on conflict" against fixed ids, so there is no
 * unique violation to save anyone: it would just succeed. `checkSeedHost` is
 * pure and exported so this can be tested without a database, and the script
 * only runs `main()` when it is the entry point, so importing it here writes
 * nothing.
 *
 * The cases below are the ones that actually happen: a Supabase pooler host
 * left in `.env`, a copy paste of a production string, a typo in
 * `SEED_ALLOW_HOST`, and a host that merely looks local.
 */
import { describe, expect, it } from "vitest";

import { checkSeedHost } from "./db-seed";

const LOCAL = "postgresql://postgres:pw@localhost:5432/clienthq";
const SUPABASE =
  "postgresql://postgres.abcdefgh:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
const PRODUCTION = "postgresql://app:pw@db.production.example:5432/clienthq";

describe("checkSeedHost lets a local database through", () => {
  it("allows localhost with no SEED_ALLOW_HOST set at all", () => {
    expect(checkSeedHost(LOCAL, undefined)).toEqual({
      ok: true,
      host: "localhost",
    });
  });

  it("allows localhost whatever SEED_ALLOW_HOST says", () => {
    expect(checkSeedHost(LOCAL, "somewhere.else").ok).toBe(true);
  });

  it("allows a host that SEED_ALLOW_HOST names exactly", () => {
    expect(
      checkSeedHost(SUPABASE, "aws-0-eu-west-2.pooler.supabase.com"),
    ).toEqual({ ok: true, host: "aws-0-eu-west-2.pooler.supabase.com" });
  });
});

describe("checkSeedHost refuses everything else", () => {
  it("refuses a remote host when SEED_ALLOW_HOST is not set", () => {
    const result = checkSeedHost(PRODUCTION, undefined);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain(
      "Refusing to seed db.production.example",
    );
  });

  it("says the variable is not set, so the fix is obvious", () => {
    const result = checkSeedHost(PRODUCTION, undefined);
    expect(result.ok === false && result.problem).toContain("(not set)");
  });

  it("names the host it was allowed to seed when the two do not match", () => {
    const result = checkSeedHost(PRODUCTION, "staging.example");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toContain(
      "(currently staging.example)",
    );
  });

  it("matches the whole host, not a prefix, so a look alike is refused", () => {
    expect(checkSeedHost(PRODUCTION, "db.production.exampl").ok).toBe(false);
    expect(checkSeedHost(PRODUCTION, "production.example").ok).toBe(false);
  });

  it("matches the whole host, not a suffix", () => {
    expect(
      checkSeedHost("postgresql://a:b@notlocalhost:5432/db", undefined).ok,
    ).toBe(false);
    expect(
      checkSeedHost(
        "postgresql://a:b@localhost.evil.example:5432/db",
        undefined,
      ).ok,
    ).toBe(false);
  });

  it("does not treat the loopback address as localhost, since only the name is allowed", () => {
    expect(
      checkSeedHost("postgresql://a:b@127.0.0.1:5432/db", undefined).ok,
    ).toBe(false);
  });

  it("is case sensitive about SEED_ALLOW_HOST, so a mismatch fails closed", () => {
    expect(checkSeedHost(PRODUCTION, "DB.PRODUCTION.EXAMPLE").ok).toBe(false);
  });
});

describe("checkSeedHost refuses a connection string it cannot read", () => {
  it.each([
    ["", "empty"],
    ["not-a-url", "no scheme"],
    ["postgresql://", "no host"],
    ["/var/run/postgresql", "a socket path, not a URL"],
  ])("refuses %o (%s)", (url) => {
    const result = checkSeedHost(url, "anything");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problem).toBe(
      "DIRECT_URL is not a valid connection URL.",
    );
  });

  it("refuses an unreadable string even when SEED_ALLOW_HOST is set to an empty one", () => {
    expect(checkSeedHost("", "").ok).toBe(false);
  });

  it("never lets an empty SEED_ALLOW_HOST match an empty host", () => {
    expect(checkSeedHost("postgresql://:5432/db", "").ok).toBe(false);
  });
});

describe("importing the seed script writes nothing", () => {
  it("only runs when it is the entry point, so this test file is safe", async () => {
    const seed: Record<string, unknown> = await import("./db-seed");
    expect(Object.keys(seed)).toEqual(["checkSeedHost"]);
  });
});
