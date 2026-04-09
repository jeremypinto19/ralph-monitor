"use client";

import { useEffect, useState } from "react";
import { format, subDays } from "date-fns";
import { DateRangePicker } from "@/components/date-range-picker";
import { ShopFilter } from "@/components/shop-filter";
import { KpiCard } from "@/components/kpi-card";
import {
  ChartCard,
  TimeSeriesChart,
  HorizontalBarChart,
  DonutChart,
} from "@/components/charts";
import {
  MessageSquare,
  Users,
  ShoppingCart,
  TrendingUp,
  Store,
} from "lucide-react";
import type { InsightsData } from "@/lib/types";

export default function OverviewPage() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
    params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
    if (shop !== "all") params.set("shopId", shop);

    fetch(`/api/insights?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          console.error("[Overview]", json.error);
          return;
        }
        setData(json);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, shop]);

  if (loading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[13px] text-muted-foreground animate-pulse">
          Loading overview...
        </p>
      </div>
    );
  }

  const deviceData = Object.entries(data.deviceBreakdown ?? {}).map(
    ([name, value]) => ({ name, value })
  );
  const modeData = Object.entries(data.modeBreakdown ?? {}).map(
    ([name, value]) => ({ name, value })
  );
  const topShopsData = (data.topShops ?? []).map((s) => ({
    name: s.shopName,
    value: s.count,
  }));

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Overview
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Aggregated statistics and trends
        </p>
      </div>

      <div className="mb-8 flex flex-wrap items-center gap-2">
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

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          title="Active Shops"
          value={data.activeShops ?? 0}
          icon={Store}
        />
        <KpiCard
          title="Conversations"
          value={data.totalConversations}
          icon={MessageSquare}
        />
        <KpiCard
          title="With Messages"
          value={data.conversationsWithMessages ?? 0}
          subtitle={`out of ${data.totalConversations}`}
          icon={Users}
        />
        <KpiCard
          title="Avg Msg / Convo"
          value={data.avgMessagesPerConversation}
          subtitle={`${data.totalMessages} total messages`}
          icon={TrendingUp}
        />
        <KpiCard
          title="Checkout Completed"
          value={(data.checkoutCompletedClassic ?? 0) + (data.checkoutCompletedJust ?? 0)}
          subtitle={`${data.checkoutCompletedClassic ?? 0} Classic · ${data.checkoutCompletedJust ?? 0} JUST`}
          icon={ShoppingCart}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Conversation volume over time">
          <TimeSeriesChart data={data.volumeOverTime} />
        </ChartCard>

        <ChartCard title="Avg messages per conversation over time">
          <TimeSeriesChart data={data.avgMessagesOverTime ?? []} color="#505048" />
        </ChartCard>

        <ChartCard title="Messages per conversation distribution">
          <HorizontalBarChart data={data.messageDistribution ?? []} />
        </ChartCard>

        <ChartCard title="Top shops">
          <HorizontalBarChart data={topShopsData} />
        </ChartCard>

        <ChartCard title="Device breakdown">
          <DonutChart data={deviceData} />
        </ChartCard>

        <ChartCard title="Mode breakdown">
          <DonutChart data={modeData} />
        </ChartCard>
      </div>
    </div>
  );
}
