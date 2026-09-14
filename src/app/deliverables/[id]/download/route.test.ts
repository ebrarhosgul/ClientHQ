/**
 * @vitest-environment node
 *
 * covers: spec 0011 AC-18, spec 0004 AC-22
 *
 * The two branches that never need a database: storage not configured (503),
 * and no Clerk key at all, which behaves exactly like a nonexistent id (404)
 * rather than crashing on a session that cannot be resolved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isClerkConfigured: vi.fn(),
  objectStorage: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ isClerkConfigured: mocks.isClerkConfigured }));
vi.mock("@/storage", () => ({ objectStorage: mocks.objectStorage }));
vi.mock("next/navigation", () => ({
  notFound: (): never => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
  redirect: (): never => {
    throw new Error("redirect should not be called here");
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isClerkConfigured.mockReturnValue(true);
  mocks.objectStorage.mockReturnValue({});
});

describe("GET /deliverables/[id]/download", () => {
  it("answers 503 with the fixed copy when storage is not configured", async () => {
    mocks.objectStorage.mockReturnValue(undefined);

    const response = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "not-even-a-uuid" }),
    });

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("File storage is not configured");
    expect(body).toContain("Downloads are unavailable in this environment.");
  });

  it("answers the app's 404 for a non uuid id, before any session is resolved", async () => {
    await expect(
      GET(new Request("http://localhost/x"), {
        params: Promise.resolve({ id: "not-even-a-uuid" }),
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("answers the app's 404 when Clerk is not configured, rather than resolving a session", async () => {
    mocks.isClerkConfigured.mockReturnValue(false);

    await expect(
      GET(new Request("http://localhost/x"), {
        params: Promise.resolve({ id: "0198a000-0000-7000-8000-000000000000" }),
      }),
    ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
