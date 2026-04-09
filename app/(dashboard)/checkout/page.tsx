"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { format, subDays } from "date-fns";
import { DateRangePicker } from "@/components/date-range-picker";
import { ShopFilter } from "@/components/shop-filter";
import { KpiCard } from "@/components/kpi-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShoppingCart,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  Bot,
  User,
  Sparkles,
  ArrowRight,
  Package,
  Tag,
} from "lucide-react";
import type {
  CheckoutEvent,
  CheckoutUserGroup,
  Attribution,
  AiConversation,
  AiConversationShopGroup,
} from "@/lib/types";
import { parseMessage } from "@/lib/message-utils";

const ATTRIBUTION_CONFIG: Record<
  Attribution,
  { label: string; color: string; bg: string }
> = {
  direct: {
    label: "Direct",
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800",
  },
  reinforcement: {
    label: "Reinforcement",
    color: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
  },
  pdp_shortcut: {
    label: "PDP Shortcut",
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
  },
  not_influenced: {
    label: "Not Influenced",
    color: "text-muted-foreground",
    bg: "bg-secondary/50 border-border",
  },
  unknown: {
    label: "Unknown",
    color: "text-muted-foreground",
    bg: "bg-secondary/50 border-border",
  },
};

export default function CheckoutPage() {
  const [userGroups, setUserGroups] = useState<CheckoutUserGroup[]>([]);
  const [totalRalphUsers, setTotalRalphUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 30));
  const [dateTo, setDateTo] = useState(() => new Date());
  const [attrFilter, setAttrFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [convos, setConvos] = useState<Map<string, AiConversation[]>>(
    new Map()
  );
  const [loadingConvos, setLoadingConvos] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setExpandedId(null);
    const params = new URLSearchParams();
    params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
    params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
    if (shop !== "all") params.set("shopId", shop);

    fetch(`/api/checkout-links?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setUserGroups(d.userGroups ?? []);
        setTotalRalphUsers(d.totalRalphUsers ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [shop, dateFrom, dateTo]);

  const fetchConversation = useCallback(
    async (distinctId: string) => {
      if (convos.has(distinctId) || loadingConvos.has(distinctId)) return;
      setLoadingConvos((prev) => new Set(prev).add(distinctId));
      try {
        const params = new URLSearchParams();
        params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
        params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
        if (shop !== "all") params.set("shopId", shop);
        const res = await fetch(`/api/conversations?${params}`);
        const data = await res.json();
        const groups: AiConversationShopGroup[] = data.groups ?? [];
        const all = groups.flatMap((g) => g.conversations);
        setConvos((prev) => new Map(prev).set(distinctId, all));
      } catch (err) {
        console.error("Failed to fetch conversations", err);
      } finally {
        setLoadingConvos((prev) => {
          const next = new Set(prev);
          next.delete(distinctId);
          return next;
        });
      }
    },
    [convos, loadingConvos, dateFrom, dateTo, shop]
  );

  const toggleRow = (group: CheckoutUserGroup) => {
    if (expandedId === group.distinctId) {
      setExpandedId(null);
    } else {
      setExpandedId(group.distinctId);
      fetchConversation(group.distinctId);
    }
  };

  const filtered = useMemo(() => {
    let groups = userGroups;
    if (attrFilter !== "all") {
      groups = groups.filter((g) => g.attribution === attrFilter);
    }
    if (eventFilter !== "all") {
      groups = groups
        .map((g) => ({
          ...g,
          events: g.events.filter((e) => e.event === eventFilter),
        }))
        .filter((g) => g.events.length > 0);
    }
    return groups;
  }, [userGroups, attrFilter, eventFilter]);

  const attrCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of userGroups) {
      counts[g.attribution] = (counts[g.attribution] ?? 0) + 1;
    }
    return counts;
  }, [userGroups]);

  const completedCount = filtered.reduce(
    (n, g) =>
      n +
      g.events.filter(
        (e) =>
          e.event === "shopify_checkout_completed" ||
          e.event === "just_checkout_completed"
      ).length,
    0
  );

  const eventLabel = (evt: string) => {
    const labels: Record<string, string> = {
      shopify_checkout_started: "Shopify Started",
      shopify_checkout_completed: "Shopify Completed",
      just_checkout_started: "JUST Started",
      just_checkout_completed: "JUST Completed",
      just_ai_checkout_redirected: "JUST Redirect",
    };
    return labels[evt] ?? evt;
  };

  const eventDot = (evt: string) => {
    if (evt.includes("completed")) return "bg-emerald-500";
    if (evt.includes("started")) return "bg-muted-foreground";
    return "bg-muted-foreground/40";
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Checkout
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Checkout events from users who conversed with Ralph
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
        <Select
          value={attrFilter}
          onValueChange={(v) => setAttrFilter(v ?? "all")}
        >
          <SelectTrigger className="h-7 w-[160px] border-border bg-transparent text-[12px]">
            <SelectValue placeholder="Attribution" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">
              All attributions
            </SelectItem>
            <SelectItem value="direct" className="text-[12px]">
              Direct
            </SelectItem>
            <SelectItem value="reinforcement" className="text-[12px]">
              Reinforcement
            </SelectItem>
            <SelectItem value="pdp_shortcut" className="text-[12px]">
              PDP Shortcut
            </SelectItem>
            <SelectItem value="not_influenced" className="text-[12px]">
              Not Influenced
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={eventFilter}
          onValueChange={(v) => setEventFilter(v ?? "all")}
        >
          <SelectTrigger className="h-7 w-[180px] border-border bg-transparent text-[12px]">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[12px]">
              All events
            </SelectItem>
            <SelectItem value="shopify_checkout_started" className="text-[12px]">
              Shopify Started
            </SelectItem>
            <SelectItem value="shopify_checkout_completed" className="text-[12px]">
              Shopify Completed
            </SelectItem>
            <SelectItem value="just_ai_checkout_redirected" className="text-[12px]">
              JUST Redirect
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI row */}
      <div className="mb-8 grid gap-4 sm:grid-cols-4">
        <KpiCard
          title="Ralph Users"
          value={totalRalphUsers}
          subtitle={`${userGroups.length} reached checkout`}
          icon={ShoppingCart}
        />
        <KpiCard
          title="Direct"
          value={attrCounts.direct ?? 0}
          subtitle="Ralph recommendation purchased"
          icon={Sparkles}
        />
        <KpiCard
          title="Reinforcement"
          value={(attrCounts.reinforcement ?? 0) + (attrCounts.pdp_shortcut ?? 0)}
          subtitle="PDP shortcut or reinforced"
          icon={ArrowRight}
        />
        <KpiCard
          title="Completed"
          value={completedCount}
          subtitle="Orders placed"
          icon={TrendingUp}
        />
      </div>

      <p className="mb-3 text-[12px] text-muted-foreground">
        {loading
          ? "Loading..."
          : `${filtered.length} user${filtered.length !== 1 ? "s" : ""} with checkout events`}
      </p>

      <div className="divide-y divide-border rounded-lg border border-border">
        {/* Header */}
        <div className="grid grid-cols-[24px_1fr_100px_130px_1fr_90px] gap-2 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span />
          <span>User</span>
          <span>Attribution</span>
          <span>Latest Event</span>
          <span>Products</span>
          <span className="text-right">Events</span>
        </div>

        {filtered.slice(0, 100).map((g) => {
          const isOpen = expandedId === g.distinctId;
          const cfg = ATTRIBUTION_CONFIG[g.attribution];
          const latestEvt = g.events[g.events.length - 1];
          const userConvos = convos.get(g.distinctId) ?? [];
          const isLoadingConvo = loadingConvos.has(g.distinctId);

          return (
            <div key={g.distinctId}>
              {/* Row */}
              <div
                className="grid cursor-pointer grid-cols-[24px_1fr_100px_130px_1fr_90px] gap-2 px-4 py-2.5 text-[13px] transition-colors hover:bg-accent/30"
                onClick={() => toggleRow(g)}
              >
                <span className="flex items-center">
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150 ${
                      isOpen ? "rotate-90" : ""
                    }`}
                  />
                </span>

                <span className="truncate font-medium text-foreground">
                  {g.customerName ?? g.distinctId.slice(0, 12) + "…"}
                </span>

                <span>
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}
                  >
                    {cfg.label}
                  </span>
                </span>

                <span className="text-muted-foreground">
                  {latestEvt
                    ? format(new Date(latestEvt.timestamp), "MMM d, HH:mm")
                    : "—"}
                </span>

                <span className="truncate text-[12px] text-muted-foreground">
                  {g.checkoutProducts.slice(0, 2).join(", ") || "—"}
                </span>

                <span className="text-right text-muted-foreground">
                  {g.events.length}
                </span>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div className="border-t border-border/50 bg-secondary/10 px-4 py-4 space-y-4">
                  {/* Attribution summary */}
                  <div
                    className={`rounded-md border px-4 py-3 ${cfg.bg}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[12px] font-semibold ${cfg.color}`}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <p className="text-[13px] text-foreground/80">
                      {g.attributionDetail}
                    </p>
                  </div>

                  {/* Recommendations vs Checkout */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-border/40 bg-background px-4 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Ralph Recommended
                        </span>
                      </div>
                      {g.ralphRecommendations.length > 0 ? (
                        <ul className="space-y-1">
                          {g.ralphRecommendations.map((r, i) => (
                            <li
                              key={i}
                              className="flex items-center gap-1.5 text-[12px] text-foreground/80"
                            >
                              <Tag className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                              {r}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          No recommendations found
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-border/40 bg-background px-4 py-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Checkout Products
                        </span>
                      </div>
                      {g.checkoutProducts.length > 0 ? (
                        <ul className="space-y-1">
                          {g.checkoutProducts.map((p, i) => {
                            const isMatch = g.ralphRecommendations.some(
                              (r) =>
                                r.toLowerCase().includes(p.toLowerCase()) ||
                                p.toLowerCase().includes(r.toLowerCase())
                            );
                            return (
                              <li
                                key={i}
                                className={`flex items-center gap-1.5 text-[12px] ${
                                  isMatch
                                    ? "text-emerald-700 dark:text-emerald-400 font-medium"
                                    : "text-foreground/80"
                                }`}
                              >
                                <Package className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                                {p}
                                {isMatch && (
                                  <span className="text-[10px] rounded bg-emerald-100 dark:bg-emerald-900/30 px-1 py-0.5">
                                    match
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          No product details available
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Checkout Events timeline */}
                  <div className="rounded-md border border-border/40 bg-background">
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
                    >
                      <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[12px] font-medium text-foreground">
                        Checkout Events
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        ({g.events.length})
                      </span>
                    </button>
                    <div className="border-t border-border/30 px-4 py-2">
                      <table className="w-full">
                        <tbody className="text-[12px]">
                          {g.events.map((ev, i) => (
                            <tr
                              key={i}
                              className="border-t border-border/20 first:border-0"
                            >
                              <td className="whitespace-nowrap py-1.5 pr-4 font-mono text-[11px] text-muted-foreground">
                                {format(new Date(ev.timestamp), "MMM d, HH:mm")}
                              </td>
                              <td className="py-1.5 pr-4">
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${eventDot(ev.event)}`}
                                  />
                                  <span className="text-foreground">
                                    {eventLabel(ev.event)}
                                  </span>
                                </span>
                              </td>
                              <td className="py-1.5 pr-4 text-muted-foreground">
                                {ev.lineItems
                                  ?.map((li) => li.title)
                                  .join(", ") ?? "—"}
                              </td>
                              <td className="py-1.5 text-right font-medium text-foreground">
                                {ev.totalPrice != null
                                  ? `${ev.currency ?? "€"}${ev.totalPrice.toFixed(2)}`
                                  : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Conversation */}
                  <ConversationSection
                    distinctId={g.distinctId}
                    firstRalphTs={g.firstRalphTs}
                    shopId={g.shopId}
                    allConvos={userConvos}
                    isLoading={isLoadingConvo}
                  />
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && !loading && (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            No checkout events found for Ralph users.
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationSection({
  distinctId,
  firstRalphTs,
  shopId,
  allConvos,
  isLoading,
}: {
  distinctId: string;
  firstRalphTs?: string | null;
  shopId: string;
  allConvos: AiConversation[];
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);

  const matched = useMemo(() => {
    if (!firstRalphTs || allConvos.length === 0) return [];

    const ralphTime = new Date(firstRalphTs).getTime();
    return allConvos
      .filter((c) => {
        if (c.shopId !== shopId) return false;
        if (!c.startedAt) return false;
        const diff = Math.abs(new Date(c.startedAt).getTime() - ralphTime);
        return diff <= 300_000;
      })
      .filter((c) => c.messageCount > 0);
  }, [allConvos, firstRalphTs, shopId]);

  return (
    <div className="rounded-md border border-border/40 bg-background">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-accent/20"
      >
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">
          Ralph Conversation
        </span>
        <span className="text-[11px] text-muted-foreground">
          ({matched.length} found)
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-border/30">
          {isLoading && (
            <p className="px-4 py-3 text-center text-[12px] text-muted-foreground animate-pulse">
              Loading...
            </p>
          )}
          {!isLoading && matched.length === 0 && (
            <p className="px-4 py-3 text-center text-[12px] text-muted-foreground">
              No Ralph conversation matched for this user.
            </p>
          )}
          {!isLoading &&
            matched.map((convo) => {
              const messages = convo.events.filter(
                (ev) =>
                  ev.eventType === "user_message" ||
                  ev.eventType === "assistant_message"
              );
              if (messages.length === 0) return null;
              return (
                <div
                  key={convo.conversationId}
                  className="border-b border-border/20 last:border-0"
                >
                  <div className="flex items-center gap-2 border-b border-border/20 px-3 py-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {convo.device ?? "—"} · {convo.mode ?? "—"}
                    </span>
                    <span>
                      {convo.startedAt
                        ? format(new Date(convo.startedAt), "MMM d, HH:mm")
                        : "—"}
                    </span>
                  </div>
                  <div className="divide-y divide-border/20">
                    {messages.map((msg, mi) => {
                      const isUser = msg.eventType === "user_message";
                      const parsed = parseMessage((msg.data ?? {}) as Record<string, unknown>);
                      const text = parsed.text;
                      if (!text && parsed.recommendations.length === 0) return null;
                      return (
                        <div
                          key={mi}
                          className={`px-4 py-3 ${!isUser ? "bg-accent/5" : ""}`}
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <div
                              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                                isUser
                                  ? "bg-foreground text-background"
                                  : "bg-accent text-foreground"
                              }`}
                            >
                              {isUser ? (
                                <User className="h-3 w-3" />
                              ) : (
                                <Bot className="h-3 w-3" />
                              )}
                            </div>
                            <span className="text-[12px] font-medium text-foreground">
                              {isUser ? "User" : "Ralph"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {format(new Date(msg.createdAt), "HH:mm:ss")}
                            </span>
                          </div>
                          {text && (
                            <div className="pl-7 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
                              {text}
                            </div>
                          )}
                          {!isUser && parsed.recommendations.length > 0 && (
                            <div className="pl-7 mt-2 space-y-1 border-t border-border/20 pt-2">
                              {parsed.recommendations.map((rec, ri) => (
                                <div key={ri} className="flex items-center gap-2 text-[12px]">
                                  <Tag className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                                  <span className="font-medium">{rec.title}</span>
                                  {rec.price && (
                                    <span className="text-muted-foreground">{rec.price}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
