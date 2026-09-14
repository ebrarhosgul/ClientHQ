/**
 * @vitest-environment node
 *
 * covers: spec 0011 AC-4, AC-12
 *
 * Signing is a local computation, so these run against the real R2
 * implementation with dummy credentials and no network: `getSignedUrl` never
 * makes a request, it only computes a signature from the command and the
 * clock.
 *
 * The one thing this file exists to prove: a signed PUT binds `Content-Type`
 * and `Content-Length` as signed headers and carries no checksum header (the
 * R2 quirk `r2.ts`'s docblock explains), and a signed GET always forces an
 * attachment download with both the ASCII fallback and the `filename*` form.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: mocks.env,
}));

const { r2Storage } = await import("./r2");

beforeEach(() => {
  mocks.env.mockReturnValue({
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "TESTACCESSKEYID",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key",
    R2_BUCKET: "test-bucket",
  });
});

describe("presignPut", () => {
  it("signs content-type and content-length as headers", async () => {
    const url = await r2Storage.presignPut({
      key: "org/o1/project/p1/d1",
      contentType: "application/pdf",
      contentLength: 1024,
      expiresInSeconds: 900,
    });

    const signedHeaders = new URL(url).searchParams.get("X-Amz-SignedHeaders");

    expect(signedHeaders).toContain("content-type");
    expect(signedHeaders).toContain("content-length");
  });

  it("never carries an SDK checksum header or query parameter", async () => {
    const url = await r2Storage.presignPut({
      key: "org/o1/project/p1/d1",
      contentType: "application/pdf",
      contentLength: 1024,
      expiresInSeconds: 900,
    });

    const lower = url.toLowerCase();

    expect(lower).not.toContain("x-amz-checksum-");
    expect(lower).not.toContain("x-amz-sdk-checksum-algorithm");

    const signedHeaders =
      new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signedHeaders).not.toContain("checksum");
  });

  it("points at the R2 endpoint built from R2_ACCOUNT_ID, addressed by the SDK's default virtual hosted style", async () => {
    const url = await r2Storage.presignPut({
      key: "org/o1/project/p1/d1",
      contentType: "application/pdf",
      contentLength: 1024,
      expiresInSeconds: 900,
    });

    expect(new URL(url).host).toBe(
      "test-bucket.test-account.r2.cloudflarestorage.com",
    );
  });
});

describe("presignGet", () => {
  const NAME = `Rapport été "final".pdf`;

  it("forces an attachment disposition with the ASCII fallback and the filename* form", async () => {
    const url = await r2Storage.presignGet({
      key: "org/o1/project/p1/d1",
      filename: NAME,
      expiresInSeconds: 120,
    });

    const disposition = new URL(url).searchParams.get(
      "response-content-disposition",
    );

    expect(disposition).toContain("attachment;");
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(NAME)}`,
    );
  });

  it("replaces every non ASCII character, and every quote or backslash, in the fallback filename so the header cannot be broken out of", async () => {
    const url = await r2Storage.presignGet({
      key: "org/o1/project/p1/d1",
      filename: NAME,
      expiresInSeconds: 120,
    });

    const disposition = new URL(url).searchParams.get(
      "response-content-disposition",
    );

    expect(disposition).toContain('filename="Rapport _t_ _final_.pdf"');
    expect(disposition).not.toMatch(/filename="[^"]*"[^;]/);
  });

  it("replaces every non ASCII character in a plain fallback filename", async () => {
    const url = await r2Storage.presignGet({
      key: "org/o1/project/p1/d1",
      filename: "café.pdf",
      expiresInSeconds: 120,
    });

    const disposition = new URL(url).searchParams.get(
      "response-content-disposition",
    );

    expect(disposition).toContain('filename="caf_.pdf"');
  });
});
