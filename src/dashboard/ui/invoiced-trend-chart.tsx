"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { formatMoney } from "@/lib/money";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/ui/primitives/chart";

/**
 * The actual Recharts composition, pulled out of `InvoicedTrendSection` into
 * its own client component. Recharts' pieces (`LineChart`, `XAxis`, and the
 * rest) reach for `React.createContext` internally, which only works inside a
 * "use client" boundary; `InvoicedTrendSection` is an async Server Component,
 * so it can never carry that directive itself. `ChartContainer` was already
 * client only, but `InvoicedTrendSection` used to import the raw Recharts
 * pieces directly too, outside any boundary, which is what broke this at
 * runtime rather than at the type level.
 */
export type InvoicedTrendChartProps = {
  readonly config: ChartConfig;
  /** One row per month; `month` plus one numeric field per currency code. */
  readonly data: readonly Record<string, string | number>[];
  /** In palette order; past the 4th, `InvoicedTrendChart` dashes the line. */
  readonly currencies: readonly string[];
};

function compactUnits(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export function InvoicedTrendChart({
  config,
  data,
  currencies,
}: InvoicedTrendChartProps) {
  return (
    <ChartContainer config={config} aria-hidden="true" className="h-64 w-full">
      <LineChart data={data} accessibilityLayer={false}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => compactUnits(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {formatMoney(Number(value), String(name))}
                  </span>
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {currencies.map((currency, index) => (
          <Line
            key={currency}
            dataKey={currency}
            name={currency}
            type="monotone"
            stroke={`var(--color-${currency})`}
            strokeWidth={2}
            strokeDasharray={index >= 4 ? "4 4" : undefined}
            dot={false}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              fill: "var(--card)",
            }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}
