"use client";

import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { DateRangePicker } from "@/components/date-range-picker";
import { ShopFilter } from "@/components/shop-filter";
import { KpiCard } from "@/components/kpi-card";
import {
  ChartCard,
  HorizontalBarChart,
  DonutChart,
  TimeSeriesChart,
} from "@/components/charts";
import { MessageSquare, Layers, Tag } from "lucide-react";
import type { AnalyticsData } from "@/lib/types";

export default function InsightsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
    params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
    if (shop !== "all") params.set("shopId", shop);

    fetch(`/api/analytics?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [shop, dateFrom, dateTo]);

  const dimensionPieData = (data?.dimensions ?? []).map((d) => ({
    name: d.name,
    value: d.count,
  }));

  const topDimensions = (data?.dimensions ?? []).slice(0, 8);

  const dimensionBarData = topDimensions.map((d) => ({
    name: d.name.length > 16 ? d.name.slice(0, 14) + "…" : d.name,
    value: d.count,
  }));

  const dailyTrendData = (data?.dailyTrends ?? []).map((t) => ({
    date: (t as Record<string, unknown>).date as string,
    count: Object.entries(t as Record<string, unknown>)
      .filter(([k]) => k !== "date")
      .reduce((sum, [, v]) => sum + (typeof v === "number" ? v : 0), 0),
  }));

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Insights
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          User questions categorized by dimension
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <ShopFilter value={shop} onChange={setShop} />
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="h-20 animate-pulse rounded-lg bg-accent/40" />
          <div className="h-64 animate-pulse rounded-lg bg-accent/40" />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <KpiCard
              title="Total Questions"
              value={data.totalQuestions}
              icon={MessageSquare}
            />
            <KpiCard
              title="Categories"
              value={data.dimensions.length}
              icon={Layers}
            />
            <KpiCard
              title="Top Category"
              value={data.dimensions[0]?.name ?? "—"}
              subtitle={
                data.dimensions[0]
                  ? `${data.dimensions[0].count} questions`
                  : undefined
              }
              icon={Tag}
            />
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-3">
            <ChartCard title="Questions by Category">
              <HorizontalBarChart data={dimensionBarData} />
            </ChartCard>
            <ChartCard title="Category Distribution">
              <DonutChart data={dimensionPieData} />
            </ChartCard>
            <ChartCard title="Device Split">
              <DonutChart
                data={Object.entries(data.deviceBreakdown ?? {}).map(
                  ([name, value]) => ({ name, value })
                )}
              />
            </ChartCard>
          </div>

          {dailyTrendData.length > 1 && (
            <div className="mb-8">
              <ChartCard title="Questions Over Time">
                <TimeSeriesChart data={dailyTrendData} />
              </ChartCard>
            </div>
          )}

          <div className="mb-4">
            <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
              Category Breakdown
            </h2>
          </div>

          <div className="divide-y divide-border rounded-lg border border-border">
            {data.dimensions.map((dim) => {
              const isExpanded = expandedDim === dim.name;
              return (
                <div key={dim.name}>
                  <button
                    onClick={() =>
                      setExpandedDim(isExpanded ? null : dim.name)
                    }
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-accent/30"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md bg-accent/60 px-2 text-[12px] font-semibold text-foreground">
                        {dim.count}
                      </span>
                      <span className="text-[13px] font-medium text-foreground">
                        {dim.name}
                      </span>
                    </div>
                    <svg
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-accent/10 px-4 py-3">
                      <div className="mb-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
                        {Object.entries(dim.byDevice).map(([dev, cnt]) => (
                          <span key={dev}>
                            <span className="font-medium text-foreground">
                              {dev}
                            </span>{" "}
                            {cnt}
                          </span>
                        ))}
                        {Object.entries(dim.byMode).map(([mode, cnt]) => (
                          <span key={mode}>
                            <span className="font-medium text-foreground">
                              {mode}
                            </span>{" "}
                            {cnt}
                          </span>
                        ))}
                      </div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Example questions
                      </p>
                      <ul className="space-y-1.5">
                        {dim.examples.map((ex, i) => (
                          <li
                            key={i}
                            className="text-[13px] leading-relaxed text-foreground/80"
                          >
                            &ldquo;{ex}&rdquo;
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {data.dimensions.length === 0 && (
              <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                No user questions found for the selected period.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
