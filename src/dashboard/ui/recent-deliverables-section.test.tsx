/**
 * @vitest-environment node
 *
 * covers: spec 0020 AC-7, AC-8, AC-11
 *
 * `RecentDeliverablesSection` is an async Server Component, rendered with
 * React's streaming renderer like `page.test.tsx`. It now receives its
 * summary as a promise, shared with `OverviewSection` (spec 0020 addendum):
 * the test builds that promise directly rather than stubbing
 * `src/dashboard/queries`. Which deliverables count as recent is
 * `queries.test.ts`'s job. Unlike the other two sections, this one never
 * renders a "view all" link: there is no deliverables list to point at.
 */
import { redirect } from "next/navigation";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatBillingDate } from "@/payments/billing-state";

import type { RecentDeliverablesSummary } from "../queries";

function redirectError(path: string): unknown {
  try {
    redirect(path);
  } catch (error) {
    return error;
  }
  throw new Error("redirect() did not throw");
}

const mocks = vi.hoisted(() => ({
  reportException: vi.fn(),
}));

vi.mock("@/observability/sentry", () => ({
  reportException: mocks.reportException,
}));

const { RecentDeliverablesSection } =
  await import("./recent-deliverables-section");

async function renderSection(
  summary: Promise<RecentDeliverablesSummary>,
): Promise<string> {
  const stream = await renderToReadableStream(
    await RecentDeliverablesSection({ summary }),
  );
  await stream.allReady;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value);
  }

  return html.replace(/<!--.*?-->/gu, "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RecentDeliverablesSection", () => {
  it("shows the empty state and the None headline, with no view all link (AC-8)", async () => {
    const html = await renderSection(
      Promise.resolve({ addedLast7Days: 0, rows: [] }),
    );

    expect(html).toContain("No deliverables yet");
    expect(html).toContain("None added in the last 7 days");
    expect(html).not.toContain("View all");
  });

  it("shows the shared and internal chips, uploader and date (AC-7)", async () => {
    const createdAt = new Date("2026-09-22T00:00:00.000Z");
    const html = await renderSection(
      Promise.resolve({
        addedLast7Days: 2,
        rows: [
          {
            id: "del-1",
            name: "Final logo.ai",
            projectId: "proj-1",
            projectName: "Rebrand",
            clientName: "Acme Ltd",
            visibleToClient: true,
            uploadedByName: "Jordan Lee",
            createdAt,
          },
          {
            id: "del-2",
            name: "Internal notes.pdf",
            projectId: "proj-1",
            projectName: "Rebrand",
            clientName: "Acme Ltd",
            visibleToClient: false,
            uploadedByName: "Jordan Lee",
            createdAt,
          },
        ],
      }),
    );

    expect(html).toContain("2 added in the last 7 days");
    expect(html).toContain("Final logo.ai, Acme Ltd");
    expect(html).toContain('href="/projects/proj-1"');
    expect(html).toContain("Shared with client");
    expect(html).toContain("Internal notes.pdf, Acme Ltd");
    expect(html).toContain("Internal");
    expect(html).toContain(
      `Added by Jordan Lee on ${formatBillingDate(createdAt)}`,
    );
    expect(html).not.toContain("View all");
  });

  it("shows an isolated error state and reports it without throwing (AC-11)", async () => {
    const error = new Error("db exploded");
    const html = await renderSection(Promise.reject(error));

    expect(html).toContain("Recent deliverables could not be loaded");
    expect(html).toContain("Try again");
    expect(mocks.reportException).toHaveBeenCalledExactlyOnceWith(
      error,
      expect.objectContaining({ tags: { section: "recent_deliverables" } }),
    );
  });

  it("rethrows a redirect instead of reporting or rendering an error (AC-11)", async () => {
    const error = redirectError("/onboarding");

    await expect(
      RecentDeliverablesSection({ summary: Promise.reject(error) }),
    ).rejects.toBe(error);

    expect(mocks.reportException).not.toHaveBeenCalled();
  });
});
