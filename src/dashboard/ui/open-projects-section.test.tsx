/**
 * @vitest-environment node
 *
 * covers: spec 0020 AC-6, AC-8, AC-11
 *
 * `OpenProjectsSection` is an async Server Component, rendered with React's
 * streaming renderer like `page.test.tsx`. It now receives its summary as a
 * promise, shared with `OverviewSection` (spec 0020 addendum): the test
 * builds that promise directly rather than stubbing `src/dashboard/queries`.
 * Which projects count and their order is `queries.test.ts`'s job.
 */
import { redirect } from "next/navigation";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenProjectsSummary } from "../queries";

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

const { OpenProjectsSection } = await import("./open-projects-section");

async function renderSection(
  summary: Promise<OpenProjectsSummary>,
): Promise<string> {
  const stream = await renderToReadableStream(
    await OpenProjectsSection({ summary }),
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

describe("OpenProjectsSection", () => {
  it("shows the empty state with a New project action and no view all link (AC-8)", async () => {
    const html = await renderSection(Promise.resolve({ count: 0, rows: [] }));

    expect(html).toContain("No open projects");
    expect(html).toContain("0 open projects");
    expect(html).toContain('href="/projects/new"');
    expect(html).not.toContain("View all open projects");
  });

  it("pluralises the count and shows a due date, status and overdue badge (AC-6)", async () => {
    const html = await renderSection(
      Promise.resolve({
        count: 1,
        rows: [
          {
            id: "proj-1",
            name: "Rebrand",
            clientName: "Acme Ltd",
            status: "in_progress",
            dueDate: "2026-09-20",
            overdue: true,
          },
        ],
      }),
    );

    expect(html).toContain("1 open project");
    expect(html).not.toContain("1 open projects");
    expect(html).toContain("Rebrand, Acme Ltd");
    expect(html).toContain('href="/projects/proj-1"');
    expect(html).toContain("2026-09-20");
    expect(html).toContain("Overdue");
    expect(html).toContain("View all open projects");
    expect(html).toContain('href="/projects"');
  });

  it("falls back to No due date and omits the overdue badge when not overdue", async () => {
    const html = await renderSection(
      Promise.resolve({
        count: 1,
        rows: [
          {
            id: "proj-2",
            name: "Website",
            clientName: "Harbour Books",
            status: "planning",
            dueDate: null,
            overdue: false,
          },
        ],
      }),
    );

    expect(html).toContain("No due date");
    expect(html).not.toContain(">Overdue<");
  });

  it("shows an isolated error state and reports it without throwing (AC-11)", async () => {
    const error = new Error("db exploded");
    const html = await renderSection(Promise.reject(error));

    expect(html).toContain("Open projects could not be loaded");
    expect(html).toContain("Try again");
    expect(mocks.reportException).toHaveBeenCalledExactlyOnceWith(
      error,
      expect.objectContaining({ tags: { section: "open_projects" } }),
    );
  });

  it("rethrows a redirect instead of reporting or rendering an error (AC-11)", async () => {
    const error = redirectError("/onboarding");

    await expect(
      OpenProjectsSection({ summary: Promise.reject(error) }),
    ).rejects.toBe(error);

    expect(mocks.reportException).not.toHaveBeenCalled();
  });
});
