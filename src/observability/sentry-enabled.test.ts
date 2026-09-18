// @vitest-environment node
import { describe, expect, it } from "vitest";

import { sentryEnabled, sentryEnvironment } from "./sentry-enabled";

const DSN = "https://public@o0.ingest.sentry.io/0";

describe("sentryEnabled (spec 0019, AC-2)", () => {
  it("sends from Vercel production when the DSN is set", () => {
    expect(sentryEnabled({ dsn: DSN, vercelEnv: "production" })).toBe(true);
  });

  it("sends from Vercel preview when the DSN is set", () => {
    expect(sentryEnabled({ dsn: DSN, vercelEnv: "preview" })).toBe(true);
  });

  it("never sends from Vercel development", () => {
    expect(sentryEnabled({ dsn: DSN, vercelEnv: "development" })).toBe(false);
  });

  it("never sends when VERCEL_ENV is a value it does not know", () => {
    expect(sentryEnabled({ dsn: DSN, vercelEnv: "test" })).toBe(false);
  });

  it("never sends when VERCEL_ENV is unset (a laptop, a CI runner)", () => {
    expect(sentryEnabled({ dsn: DSN, vercelEnv: undefined })).toBe(false);
  });

  it("never sends without a DSN, whatever the environment", () => {
    expect(sentryEnabled({ dsn: undefined, vercelEnv: "production" })).toBe(
      false,
    );
    expect(sentryEnabled({ dsn: "", vercelEnv: "production" })).toBe(false);
  });
});

describe("sentryEnvironment", () => {
  it("is VERCEL_ENV when set, else development", () => {
    expect(sentryEnvironment("preview")).toBe("preview");
    expect(sentryEnvironment(undefined)).toBe("development");
  });
});
