/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-12, AC-14
 *
 * The three portal events, each on the client and never on the person or the
 * contact. `afterResponse` is stubbed to run immediately, since it has its
 * own test in `after-response.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactContext } from "@/db/tenant";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
}));

vi.mock("@/analytics", () => ({
  afterResponse: (task: () => void) => task(),
  analytics: () => ({ track: mocks.track }),
}));

const { trackPortalFileDownload, trackPortalInvoiceView, trackPortalView } =
  await import("./analytics");

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx: ContactContext = {
  kind: "contact",
  orgId: "org_1",
  userId: "user_1",
  clerkUserId: "clerk_1",
  clientId: "client_1",
  contactId: "contact_1",
};

describe("trackPortalView", () => {
  it("tracks portal.viewed on the client, with the path", () => {
    trackPortalView(ctx, "/portal/invoices");

    expect(mocks.track).toHaveBeenCalledWith("portal.viewed", {
      distinctId: { kind: "client", clientId: "client_1" },
      orgId: "org_1",
      properties: { client_id: "client_1", path: "/portal/invoices" },
    });
  });

  it("never names the person or the contact", () => {
    trackPortalView(ctx, "/portal");

    const serialized = JSON.stringify(mocks.track.mock.calls[0]);
    expect(serialized).not.toContain("user_1");
    expect(serialized).not.toContain("contact_1");
  });
});

describe("trackPortalInvoiceView", () => {
  it("tracks portal.invoice_viewed on the client with the invoice id", () => {
    trackPortalInvoiceView(ctx, "invoice_9");

    expect(mocks.track).toHaveBeenCalledWith("portal.invoice_viewed", {
      distinctId: { kind: "client", clientId: "client_1" },
      orgId: "org_1",
      properties: { client_id: "client_1", invoice_id: "invoice_9" },
    });
  });
});

describe("trackPortalFileDownload", () => {
  it("tracks portal.file_downloaded on the client with the deliverable id", () => {
    trackPortalFileDownload(ctx, "deliverable_7");

    expect(mocks.track).toHaveBeenCalledWith("portal.file_downloaded", {
      distinctId: { kind: "client", clientId: "client_1" },
      orgId: "org_1",
      properties: { client_id: "client_1", deliverable_id: "deliverable_7" },
    });
  });

  it("tracks synchronously, unlike the page and invoice views", () => {
    // The download route may stream its response before an afterResponse
    // callback would run, so this one call is not deferred.
    trackPortalFileDownload(ctx, "deliverable_7");

    expect(mocks.track).toHaveBeenCalledTimes(1);
  });
});
