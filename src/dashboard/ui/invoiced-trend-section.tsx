import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

import type { StaffContext } from "@/db/tenant";
import { formatMoney } from "@/lib/money";
import { reportException } from "@/observability/sentry";
import { EmptyState } from "@/ui/patterns/empty-state";
import { ErrorState } from "@/ui/patterns/error-state";
import { Button } from "@/ui/primitives/button";
import { type ChartConfig } from "@/ui/primitives/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";
import { Skeleton, SkeletonRegion } from "@/ui/primitives/skeleton";

import { invoicedTrend, type InvoicedTrend } from "../queries";
import { InvoicedTrendChart } from "./invoiced-trend-chart";

export const INVOICED_TREND_HEADING_ID = "dashboard-invoiced-heading";

/** The chart's own `<Suspense>` fallback (AC-24). */
export function InvoicedTrendSkeleton() {
  return (
    <section
      aria-labelledby={INVOICED_TREND_HEADING_ID}
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2
        id={INVOICED_TREND_HEADING_ID}
        className="text-base font-semibold tracking-tight"
      >
        Invoiced by month
      </h2>
      <SkeletonRegion label="Loading invoiced by month">
        <Skeleton className="h-64 w-full" />
      </SkeletonRegion>
    </section>
  );
}

export type InvoicedTrendSectionProps = {
  readonly ctx: StaffContext;
  readonly todayUtc: string;
};

/** The tokens each currency line draws from, in `currencies`' order. Past the 4th, the palette repeats with a dashed stroke (AC-21). */
const CHART_COLOR_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
] as const;

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function totalFor(
  month: InvoicedTrend["months"][number],
  currency: string,
): number | undefined {
  return month.totalsByCurrency.find((total) => total.currency === currency)
    ?.cents;
}

/**
 * The invoiced by month chart (spec 0020 addendum, AC-21 to AC-23). Its own
 * try/catch: a failed read never blanks the rest of the dashboard.
 */
export async function InvoicedTrendSection({
  ctx,
  todayUtc,
}: InvoicedTrendSectionProps) {
  let trend: InvoicedTrend | undefined;

  try {
    trend = await invoicedTrend(ctx, todayUtc);
  } catch (error) {
    unstable_rethrow(error);

    reportException(error, {
      tags: { section: "invoiced_trend" },
      fingerprint: ["dashboard_section_failed", "invoiced_trend"],
    });
  }

  if (trend === undefined) {
    return (
      <section
        aria-labelledby={INVOICED_TREND_HEADING_ID}
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id={INVOICED_TREND_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Invoiced by month
        </h2>
        <ErrorState
          heading="Invoiced by month could not be loaded"
          description="The rest of the dashboard is fine. Try again to load this section."
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard">Try again</Link>
            </Button>
          }
        />
      </section>
    );
  }

  if (trend.currencies.length === 0) {
    return (
      <section
        aria-labelledby={INVOICED_TREND_HEADING_ID}
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2
          id={INVOICED_TREND_HEADING_ID}
          className="text-base font-semibold tracking-tight"
        >
          Invoiced by month
        </h2>
        <EmptyState
          heading="No invoices in the last 6 months"
          description="Once an invoice is issued, this chart will show the trend by month."
        />
      </section>
    );
  }

  const config: ChartConfig = Object.fromEntries(
    trend.currencies.map((currency, index) => [
      currency,
      {
        label: currency,
        color: CHART_COLOR_TOKENS[index % CHART_COLOR_TOKENS.length],
      },
    ]),
  );

  const chartData = trend.months.map((month) => ({
    month: monthLabel(month.month),
    ...Object.fromEntries(
      trend.currencies.map((currency) => [
        currency,
        totalFor(month, currency) ?? 0,
      ]),
    ),
  }));

  return (
    <section
      aria-labelledby={INVOICED_TREND_HEADING_ID}
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2
        id={INVOICED_TREND_HEADING_ID}
        className="text-base font-semibold tracking-tight"
      >
        Invoiced by month
      </h2>

      <InvoicedTrendChart
        config={config}
        data={chartData}
        currencies={trend.currencies}
      />

      <div className="sr-only">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Month</TableHead>
              {trend.currencies.map((currency) => (
                <TableHead key={currency} scope="col">
                  {currency}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.months.map((month) => (
              <TableRow key={month.month}>
                <TableHead scope="row">{monthLabel(month.month)}</TableHead>
                {trend.currencies.map((currency) => {
                  const cents = totalFor(month, currency);
                  return (
                    <TableCell key={currency}>
                      {cents === undefined ? "—" : formatMoney(cents, currency)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
