/**
 * @vitest-environment node
 *
 * covers: spec 0020 AC-3, AC-4, AC-5, AC-8, AC-11
 *
 * `OverdueInvoicesSection` is an async Server Component, so it is rendered
 * with React's own streaming renderer (the same approach `page.test.tsx`
 * uses) rather than Testing Library's `render()`. It now receives its summary
 * as a promise, shared with `OverviewSection` (spec 0020 addendum): the test
 * builds that promise directly rather than stubbing `src/dashboard/queries`.
 * Which invoices count and how they're ordered is `queries.test.ts`'s job.
 */
import { redirect } from "next/navigation";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatMoney } from "@/lib/money";

import type { OverdueInvoicesSummary } from "../queries";

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

const { OverdueInvoicesSection } = await import("./overdue-invoices-section");

async function renderSection(
  summary: Promise<OverdueInvoicesSummary>,
): Promise<string> {
  const stream = await renderToReadableStream(
    await OverdueInvoicesSection({ summary }),
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

describe("OverdueInvoicesSection", () => {
  it("shows the empty state and no view all link when nothing is overdue (AC-8)", async () => {
    const html = await renderSection(
      Promise.resolve({ count: 0, totals: [], rows: [] }),
    );

    expect(html).toContain("Nothing overdue");
    expect(html).toContain("0 overdue invoices");
    expect(html).not.toContain("View all overdue invoices");
  });

  it("pluralises the count and lists a per currency total (AC-3, AC-4)", async () => {
    const html = await renderSection(
      Promise.resolve({
        count: 1,
        totals: [{ currency: "USD", cents: 10_000 }],
        rows: [
          {
            id: "inv-1",
            number: 7,
            clientName: "Acme Ltd",
            totalCents: 10_000,
            currency: "USD",
            dueDate: "2026-09-20",
            daysOverdue: 1,
          },
        ],
      }),
    );

    expect(html).toContain("1 overdue invoice");
    expect(html).not.toContain("1 overdue invoices");
    expect(html).toContain(`${formatMoney(10_000, "USD")} overdue`);
    expect(html).toContain("INV-0007, Acme Ltd");
    expect(html).toContain("1 day overdue");
    expect(html).not.toContain("1 days overdue");
    expect(html).toContain('href="/invoices/inv-1"');
    expect(html).toContain("View all overdue invoices");
    expect(html).toContain('href="/invoices?status=overdue"');
  });

  it("lists multiple currency totals and pluralises days overdue", async () => {
    const html = await renderSection(
      Promise.resolve({
        count: 2,
        totals: [
          { currency: "EUR", cents: 5_000 },
          { currency: "USD", cents: 12_500 },
        ],
        rows: [
          {
            id: "inv-2",
            number: 12,
            clientName: "Harbour Books",
            totalCents: 12_500,
            currency: "USD",
            dueDate: "2026-09-15",
            daysOverdue: 9,
          },
        ],
      }),
    );

    expect(html).toContain("2 overdue invoices");
    expect(html).toContain(`${formatMoney(5_000, "EUR")} overdue`);
    expect(html).toContain(`${formatMoney(12_500, "USD")} overdue`);
    expect(html).toContain("9 days overdue");
  });

  it("shows an isolated error state and reports it without throwing (AC-11)", async () => {
    const error = new Error("db exploded");
    const html = await renderSection(Promise.reject(error));

    expect(html).toContain("Overdue invoices could not be loaded");
    expect(html).toContain("Try again");
    expect(mocks.reportException).toHaveBeenCalledExactlyOnceWith(
      error,
      expect.objectContaining({ tags: { section: "overdue_invoices" } }),
    );
  });

  it("rethrows a redirect instead of reporting or rendering an error (AC-11)", async () => {
    const error = redirectError("/onboarding");

    await expect(
      OverdueInvoicesSection({ summary: Promise.reject(error) }),
    ).rejects.toBe(error);

    expect(mocks.reportException).not.toHaveBeenCalled();
  });
});
