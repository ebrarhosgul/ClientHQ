/**
 * @vitest-environment node
 *
 * covers: spec 0013 AC-1
 *
 * The route file itself does nothing but resolve the route param and
 * delegate; `handle-request.test.ts` covers the handler's own behaviour.
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleInvoicePdfRequest: vi.fn(async () => new Response("ok")),
}));

vi.mock("@/invoices/pdf/handle-request", () => ({
  handleInvoicePdfRequest: mocks.handleInvoicePdfRequest,
}));

const { GET } = await import("./route");

describe("GET /invoices/[id]/pdf", () => {
  it("delegates the resolved id to the shared handler", async () => {
    await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "the-id" }),
    });

    expect(mocks.handleInvoicePdfRequest).toHaveBeenCalledWith("the-id");
  });
});
