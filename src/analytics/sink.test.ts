// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { apiHostFor, deletePersonThroughApi } from "./sink";

const options = {
  host: "https://eu.i.posthog.com",
  personalApiKey: "phx_secret",
  projectId: "12345",
};

function fetchReturning(
  responses: readonly { readonly status: number; readonly body?: unknown }[],
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;

  const doFetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const response = responses[index] ?? { status: 500 };
      index += 1;

      // A 204 carries no body, and `Response` refuses one.
      return new Response(
        response.status === 204 ? null : JSON.stringify(response.body ?? {}),
        { status: response.status },
      );
    },
  );

  return { doFetch: doFetch as unknown as typeof fetch, calls };
}

describe("apiHostFor", () => {
  it("maps the ingestion host to the app host and leaves others alone", () => {
    expect(apiHostFor("https://eu.i.posthog.com")).toBe(
      "https://eu.posthog.com",
    );
    expect(apiHostFor("https://us.i.posthog.com")).toBe(
      "https://us.posthog.com",
    );
    expect(apiHostFor("https://posthog.example.com")).toBe(
      "https://posthog.example.com",
    );
  });
});

describe("deletePersonThroughApi (spec 0019, AC-20)", () => {
  it("looks the person up by distinct id, then deletes them with their events", async () => {
    const { doFetch, calls } = fetchReturning([
      { status: 200, body: { results: [{ id: 42 }] } },
      { status: 204 },
    ]);

    await deletePersonThroughApi(options, "user_1", doFetch);

    expect(calls[0]?.url).toBe(
      "https://eu.posthog.com/api/projects/12345/persons/?distinct_id=user_1",
    );
    expect(calls[1]?.url).toBe(
      "https://eu.posthog.com/api/projects/12345/persons/42/?delete_events=true",
    );
    expect(calls[1]?.init?.method).toBe("DELETE");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer phx_secret",
    );
  });

  it("treats no such person as already erased", async () => {
    const { doFetch, calls } = fetchReturning([
      { status: 200, body: { results: [] } },
    ]);

    await expect(
      deletePersonThroughApi(options, "user_1", doFetch),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("throws on a failed lookup or deletion, so the caller can count it", async () => {
    await expect(
      deletePersonThroughApi(
        options,
        "user_1",
        fetchReturning([{ status: 503 }]).doFetch,
      ),
    ).rejects.toThrow("person lookup failed: 503");

    await expect(
      deletePersonThroughApi(
        options,
        "user_1",
        fetchReturning([
          { status: 200, body: { results: [{ id: 1 }] } },
          { status: 500 },
        ]).doFetch,
      ),
    ).rejects.toThrow("person deletion failed: 500");
  });

  it("throws analytics_unconfigured without the private key pair", async () => {
    await expect(
      deletePersonThroughApi(
        { ...options, personalApiKey: undefined },
        "user_1",
        fetchReturning([]).doFetch,
      ),
    ).rejects.toThrow("analytics_unconfigured");
  });
});
