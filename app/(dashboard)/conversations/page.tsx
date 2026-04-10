"use client";

import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
  Fragment,
} from "react";
import { format, subDays } from "date-fns";
import {
  DashboardScopeFilter,
  ScopeFilterRow,
  ScopeFilterSection,
} from "@/components/dashboard-scope-filter";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Keyboard,
  ListOrdered,
  Loader2,
  MousePointerClick,
  Zap,
} from "lucide-react";
import {
  ConversationFeedbackTableCell,
  MessageFeedbackDetail,
} from "@/components/conversation-message-feedback";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AiConversation,
  AiConversationShopGroup,
  ConversationEnrichment,
  ConversationLaunchSource,
} from "@/lib/types";
import { parseMessage, extractPlainText } from "@/lib/message-utils";
import { summarizeConversationFeedback } from "@/lib/conversation-feedback";
import type {
  CheckoutPlatformFilter,
  CheckoutStageFilter,
} from "@/lib/checkout-filters";
import { checkoutEventMatchesFilters } from "@/lib/checkout-filters";

/** Client-side filter on assistant message votes (no API change). */
type ConversationFeedbackFilter = "all" | "up" | "down" | "none";

function conversationMatchesFeedbackFilter(
  c: AiConversation,
  filter: ConversationFeedbackFilter,
): boolean {
  if (filter === "all") return true;
  const { hasUp, hasDown } = summarizeConversationFeedback(c.events);
  if (filter === "none") return !hasUp && !hasDown;
  if (filter === "up") return hasUp;
  if (filter === "down") return hasDown;
  return true;
}

/** Uses PostHog bundle enrichments; rows not yet enriched stay visible until data loads. */
function conversationMatchesCheckoutFilters(
  conversationId: string,
  enrichments: Record<string, ConversationEnrichment>,
  platform: CheckoutPlatformFilter,
  stage: CheckoutStageFilter,
): boolean {
  if (platform === "all" && stage === "all") return true;
  const en = enrichments[conversationId];
  if (!en) return true;
  const evs = en.checkoutEvents ?? [];
  if (evs.length === 0) return false;
  return evs.some((e) => checkoutEventMatchesFilters(e.event, platform, stage));
}

interface TimelineEvent {
  time: string;
  event: string;
  rawEvent: string;
  details: string;
}

interface UserJourney {
  summary: string;
  timeline: TimelineEvent[];
  totalEvents: number;
  resolved: boolean;
  resolvedDistinctId?: string;
}

type ConvWithShop = AiConversation & { shopName: string };

const CONVERSATIONS_PAGE_SIZE = 100;

const ATTRIBUTION_COLORS: Record<string, string> = {
  direct: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  reinforcement:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  pdp_shortcut:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  not_influenced:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  unknown: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const ATTRIBUTION_LABELS: Record<string, string> = {
  direct: "Direct",
  reinforcement: "Reinforcement",
  pdp_shortcut: "PDP Shortcut",
  not_influenced: "Not Influenced",
  unknown: "Unknown",
};

function LaunchIndicator({
  source,
}: {
  source: ConversationLaunchSource | undefined;
}) {
  if (source === undefined) {
    return (
      <span
        className="text-muted-foreground"
        title="Launch type requires PostHog data for the selected date range"
      >
        —
      </span>
    );
  }
  if (source === "shortcut") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        title="First interaction was a shortcut click (PostHog: just_ai_shortcut_clicked before first just_ai_message_sent)"
      >
        <Zap className="h-3 w-3 shrink-0" aria-hidden />
        Shortcut
      </span>
    );
  }
  if (source === "input") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        title="Started with a typed message before any shortcut in this session"
      >
        <Keyboard className="h-3 w-3 shrink-0" aria-hidden />
        Typed
      </span>
    );
  }
  return (
    <span
      className="text-muted-foreground text-xs"
      title="No shortcut or typed send event in PostHog for this conversation"
    >
      Unknown
    </span>
  );
}

function AttributionBadge({ attribution }: { attribution: string | null }) {
  if (!attribution) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ATTRIBUTION_COLORS[attribution] ?? ""}`}
    >
      {ATTRIBUTION_LABELS[attribution] ?? attribution}
    </span>
  );
}

function CheckoutBadge({
  enrichment,
}: {
  enrichment: ConversationEnrichment | undefined;
}) {
  if (!enrichment || !enrichment.hasCheckout) {
    return <span className="text-muted-foreground">—</span>;
  }
  const completed = enrichment.checkoutCompleted;
  const type = enrichment.checkoutType;

  return (
    <div className="flex items-center gap-1.5">
      {completed ? (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
          ✓ Purchased
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900 dark:text-orange-200">
          Started
        </span>
      )}
      {type && (
        <Badge variant="outline" className="text-[10px] uppercase">
          {type === "both"
            ? "JUST+Shopify"
            : type === "just"
              ? "JUST"
              : "Shopify"}
        </Badge>
      )}
    </div>
  );
}

function JourneyTimeline({
  journey,
  loading,
  conversationId,
  onRetry,
  retryLoading,
}: {
  journey: UserJourney | null | undefined;
  loading: boolean;
  conversationId: string;
  onRetry: (conversationId: string) => void;
  retryLoading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading user journey...
      </div>
    );
  }
  if (!journey || !journey.resolved) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
        <p>Could not resolve user identity for this conversation.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retryLoading}
          onClick={() => onRetry(conversationId)}
        >
          {retryLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Retrying…
            </>
          ) : (
            "Retry user journey"
          )}
        </Button>
      </div>
    );
  }
  if (journey.timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-muted-foreground">
        <p>No PostHog events found for this user.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retryLoading}
          onClick={() => onRetry(conversationId)}
        >
          {retryLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Retrying…
            </>
          ) : (
            "Retry user journey"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md bg-muted/50 p-3 text-sm">
        {journey.summary}
      </div>
      <div className="relative ml-3 border-l border-border pl-4">
        {journey.timeline.map((step, i) => {
          const isCheckout = step.rawEvent.includes("checkout");
          const isBuy = step.rawEvent === "just_ai_buy_clicked";
          return (
            <div key={i} className="relative mb-3 pb-1">
              <div
                className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                  isCheckout || isBuy ? "bg-green-500" : "bg-primary"
                }`}
              />
              <div className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {format(new Date(step.time), "HH:mm:ss")}
                </span>
                <span
                  className={`font-medium ${isCheckout || isBuy ? "text-green-700 dark:text-green-400" : ""}`}
                >
                  {step.event}
                </span>
              </div>
              {step.details && (
                <p className="ml-[4.5rem] text-xs text-muted-foreground">
                  {step.details}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttributionDetail({
  enrichment,
}: {
  enrichment: ConversationEnrichment | undefined;
}) {
  if (!enrichment) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Enrichment data not available.
      </div>
    );
  }

  const {
    ralphRecommendations,
    checkoutProducts,
    attribution,
    attributionDetail,
    checkoutEvents,
  } = enrichment;

  return (
    <div className="space-y-4">
      {/* Attribution summary */}
      <div className="rounded-md border p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Attribution:</span>
          <AttributionBadge attribution={attribution} />
        </div>
        {attributionDetail && (
          <p className="mt-1 text-xs text-muted-foreground">
            {attributionDetail}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Ralph recommendations */}
        <div className="rounded-md border p-3">
          <h4 className="mb-2 text-sm font-medium">Ralph Recommendations</h4>
          {ralphRecommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No recommendations found
            </p>
          ) : (
            <ul className="space-y-1">
              {ralphRecommendations.map((rec, i) => (
                <li key={i} className="text-xs">
                  <span className="mr-1">🏷️</span> {rec}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Purchased items */}
        <div className="rounded-md border p-3">
          <h4 className="mb-2 text-sm font-medium">Checkout Products</h4>
          {checkoutProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No checkout products found
            </p>
          ) : (
            <ul className="space-y-1">
              {checkoutProducts.map((p, i) => (
                <li key={i} className="text-xs">
                  <span className="mr-1">🛒</span> {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Checkout events */}
      {checkoutEvents.length > 0 && (
        <div className="rounded-md border p-3">
          <h4 className="mb-2 text-sm font-medium">Checkout Events</h4>
          <div className="space-y-1">
            {checkoutEvents.map((evt, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">
                  {format(new Date(evt.timestamp), "MMM d, HH:mm:ss")}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {evt.event
                    .replace(/^(shopify_|just_)/, "")
                    .replace(/_/g, " ")}
                </Badge>
                {evt.totalPrice != null && (
                  <span className="text-muted-foreground">
                    {evt.currency ?? "€"}
                    {evt.totalPrice.toFixed(2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConversationsPage() {
  const [groups, setGroups] = useState<AiConversationShopGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState("all");
  const [dateFrom, setDateFrom] = useState(() => subDays(new Date(), 7));
  const [dateTo, setDateTo] = useState(() => new Date());
  const [device, setDevice] = useState("all");
  const [launchSource, setLaunchSource] = useState<
    "all" | ConversationLaunchSource
  >("all");
  const [feedbackFilter, setFeedbackFilter] =
    useState<ConversationFeedbackFilter>("all");
  const [checkoutPlatform, setCheckoutPlatform] =
    useState<CheckoutPlatformFilter>("all");
  const [checkoutStage, setCheckoutStage] =
    useState<CheckoutStageFilter>("all");
  const [search, setSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [tablePage, setTablePage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Enrichment state
  const [enrichments, setEnrichments] = useState<
    Record<string, ConversationEnrichment>
  >({});
  const [enriching, setEnriching] = useState(false);

  // Journeys prefetched in one PostHog batch (see journeyBatchIdKey effect)
  const [journeys, setJourneys] = useState<Record<string, UserJourney | null>>(
    {},
  );
  const [journeysBulkLoading, setJourneysBulkLoading] = useState(false);
  const [journeyRetryingId, setJourneyRetryingId] = useState<string | null>(
    null,
  );
  const [posthogRowCacheToken, setPosthogRowCacheToken] = useState<
    string | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setPosthogRowCacheToken(null);
      const params = new URLSearchParams();
      params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
      params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
      if (shop !== "all") params.set("shopId", shop);
      if (device !== "all") params.set("device", device);
      if (launchSource !== "all") params.set("launchSource", launchSource);

      try {
        const r = await fetch(`/api/conversations?${params}`);
        const d = await r.json();
        if (!cancelled) {
          setGroups(d.groups ?? []);
          setPosthogRowCacheToken(
            typeof d.posthogRowCacheToken === "string"
              ? d.posthogRowCacheToken
              : null,
          );
          setEnrichments({});
          setJourneys({});
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop, dateFrom, dateTo, device, launchSource]);

  const allConversations = useMemo(() => {
    let flat: ConvWithShop[] = groups.flatMap((g) =>
      g.conversations.map((c) => ({
        ...c,
        shopName: g.shopName ?? g.shopId,
      })),
    );
    flat.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

    if (hideEmpty) {
      flat = flat.filter((c) => c.messageCount > 0);
    }

    if (feedbackFilter !== "all") {
      flat = flat.filter((c) =>
        conversationMatchesFeedbackFilter(c, feedbackFilter),
      );
    }

    if (checkoutPlatform !== "all" || checkoutStage !== "all") {
      flat = flat.filter((c) =>
        conversationMatchesCheckoutFilters(
          c.conversationId,
          enrichments,
          checkoutPlatform,
          checkoutStage,
        ),
      );
    }

    if (!search) return flat;
    const lower = search.toLowerCase();
    return flat.filter(
      (c) =>
        c.conversationId.toLowerCase().includes(lower) ||
        c.shopName.toLowerCase().includes(lower) ||
        c.events.some((e) => {
          const msg = extractPlainText(
            (e.data ?? {}) as Record<string, unknown>,
          );
          return msg.toLowerCase().includes(lower);
        }),
    );
  }, [
    groups,
    search,
    hideEmpty,
    feedbackFilter,
    enrichments,
    checkoutPlatform,
    checkoutStage,
  ]);

  /** Single stable useEffect dependency avoids React “deps array changed size” (common with Fast Refresh when deps are edited). */
  const conversationsTableResetKey = useMemo(
    () =>
      [
        shop,
        format(dateFrom, "yyyy-MM-dd"),
        format(dateTo, "yyyy-MM-dd"),
        device,
        launchSource,
        search,
        hideEmpty ? "1" : "0",
        feedbackFilter,
        checkoutPlatform,
        checkoutStage,
      ].join("\0"),
    [
      shop,
      dateFrom,
      dateTo,
      device,
      launchSource,
      search,
      hideEmpty,
      feedbackFilter,
      checkoutPlatform,
      checkoutStage,
    ],
  );

  useEffect(() => {
    setTablePage(0);
  }, [conversationsTableResetKey]);

  useEffect(() => {
    const max = Math.max(
      0,
      Math.ceil(allConversations.length / CONVERSATIONS_PAGE_SIZE) - 1,
    );
    setTablePage((p) => Math.min(p, max));
  }, [allConversations.length]);

  const conversationPageCount = Math.max(
    1,
    Math.ceil(allConversations.length / CONVERSATIONS_PAGE_SIZE) || 1,
  );
  const conversationPage = Math.min(tablePage, conversationPageCount - 1);

  const pagedConversations = useMemo(() => {
    const start = conversationPage * CONVERSATIONS_PAGE_SIZE;
    return allConversations.slice(start, start + CONVERSATIONS_PAGE_SIZE);
  }, [allConversations, conversationPage]);

  const pagedConversationsRef = useRef<ConvWithShop[]>(pagedConversations);
  pagedConversationsRef.current = pagedConversations;

  const bundleConversationKey = useMemo(() => {
    return pagedConversations
      .filter((c) => c.messageCount > 0)
      .slice(0, CONVERSATIONS_PAGE_SIZE)
      .map((c) => c.conversationId)
      .sort()
      .join(",");
  }, [pagedConversations]);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (bundleConversationKey.length === 0) {
      setJourneysBulkLoading(false);
      return;
    }

    const ids = bundleConversationKey.split(",").filter(Boolean);
    const convById = new Map<string, ConvWithShop>();
    for (const c of pagedConversationsRef.current) {
      if (ids.includes(c.conversationId)) convById.set(c.conversationId, c);
    }

    let cancelled = false;
    void (async () => {
      setJourneysBulkLoading(true);
      setEnriching(true);
      try {
        const conversations = ids.map((id) => {
          const c = convById.get(id)!;
          return {
            conversationId: c.conversationId,
            shopId: c.shopId,
            startedAt: c.startedAt ?? "",
            posthogDistinctId: c.posthogDistinctId ?? undefined,
          };
        });

        const eventsByConversationId: Record<
          string,
          Record<string, unknown>[]
        > = {};
        for (const id of ids) {
          const c = convById.get(id)!;
          eventsByConversationId[id] = c.events
            .filter((e) => e.eventType === "assistant_message")
            .map((e) => ({
              eventType: e.eventType,
              data: e.data,
            })) as Record<string, unknown>[];
        }

        const r = await fetch("/api/conversations/posthog-bundle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dateFrom: format(dateFrom, "yyyy-MM-dd"),
            dateTo: format(dateTo, "yyyy-MM-dd"),
            conversations,
            eventsByConversationId,
            ...(posthogRowCacheToken ? { posthogRowCacheToken } : {}),
          }),
        });
        const d = await r.json();
        if (cancelled) return;
        if (d.error) {
          console.error(d.error);
          return;
        }
        if (d.journeys && typeof d.journeys === "object") {
          setJourneys((prev) => ({
            ...prev,
            ...(d.journeys as Record<string, UserJourney | null>),
          }));
        }
        if (d.enrichments && typeof d.enrichments === "object") {
          setEnrichments((prev) => ({
            ...prev,
            ...(d.enrichments as Record<string, ConversationEnrichment>),
          }));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) {
          setJourneysBulkLoading(false);
          setEnriching(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, bundleConversationKey, dateFrom, dateTo, posthogRowCacheToken]);

  const toggleExpand = useCallback(
    (conv: ConvWithShop) => {
      if (expandedId === conv.conversationId) {
        setExpandedId(null);
      } else {
        setExpandedId(conv.conversationId);
      }
    },
    [expandedId],
  );

  const handleJourneyRetry = useCallback(
    async (conversationId: string) => {
      setJourneyRetryingId(conversationId);
      try {
        const params = new URLSearchParams();
        params.set("conversationId", conversationId);
        params.set("dateFrom", format(dateFrom, "yyyy-MM-dd"));
        params.set("dateTo", format(dateTo, "yyyy-MM-dd"));
        const r = await fetch(`/api/user-journey?${params}`);
        const d = await r.json();
        if (d.error) {
          console.error(d.error);
          return;
        }
        setJourneys((prev) => ({
          ...prev,
          [conversationId]: d as UserJourney,
        }));
      } catch (e) {
        console.error(e);
      } finally {
        setJourneyRetryingId(null);
      }
    },
    [dateFrom, dateTo],
  );

  const enrichedCount = useMemo(
    () => Object.values(enrichments).filter((e) => e.hasCheckout).length,
    [enrichments],
  );

  const conversationFilterCategories = useMemo(() => {
    const deviceSummary =
      device === "all"
        ? "All devices"
        : device === "mobile"
          ? "Mobile"
          : "Desktop";
    const launchSummary =
      launchSource === "all"
        ? "All launches"
        : launchSource === "shortcut"
          ? "Shortcut"
          : launchSource === "input"
            ? "Typed message"
            : "Unknown";
    const feedbackSummary =
      feedbackFilter === "all"
        ? "All feedback"
        : feedbackFilter === "up"
          ? "Thumbs up"
          : feedbackFilter === "down"
            ? "Thumbs down"
            : "No feedback";
    const checkoutPlatformSummary =
      checkoutPlatform === "all"
        ? "Shopify & JUST"
        : checkoutPlatform === "shopify"
          ? "Shopify only"
          : "JUST only";
    const checkoutStageSummary =
      checkoutStage === "all"
        ? "All stages"
        : checkoutStage === "started"
          ? "Started"
          : checkoutStage === "completed"
            ? "Completed"
            : "JUST redirect";

    return [
      {
        id: "device",
        label: "Device",
        summary: deviceSummary,
        panel: (
          <div className="space-y-0.5">
            <ScopeFilterRow
              selected={device === "all"}
              onSelect={() => setDevice("all")}
            >
              All devices
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={device === "mobile"}
              onSelect={() => setDevice("mobile")}
            >
              Mobile
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={device === "desktop"}
              onSelect={() => setDevice("desktop")}
            >
              Desktop
            </ScopeFilterRow>
          </div>
        ),
      },
      {
        id: "launch",
        label: "Launch",
        summary: launchSummary,
        panel: (
          <div className="space-y-0.5">
            <ScopeFilterRow
              selected={launchSource === "all"}
              onSelect={() => setLaunchSource("all")}
            >
              All launches
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={launchSource === "shortcut"}
              onSelect={() => setLaunchSource("shortcut")}
            >
              Shortcut
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={launchSource === "input"}
              onSelect={() => setLaunchSource("input")}
            >
              Typed message
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={launchSource === "unknown"}
              onSelect={() => setLaunchSource("unknown")}
            >
              Unknown
            </ScopeFilterRow>
          </div>
        ),
      },
      {
        id: "feedback",
        label: "Feedback",
        summary: feedbackSummary,
        panel: (
          <div className="space-y-0.5">
            <ScopeFilterRow
              selected={feedbackFilter === "all"}
              onSelect={() => setFeedbackFilter("all")}
            >
              All feedback
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={feedbackFilter === "up"}
              onSelect={() => setFeedbackFilter("up")}
            >
              With thumbs up
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={feedbackFilter === "down"}
              onSelect={() => setFeedbackFilter("down")}
            >
              With thumbs down
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={feedbackFilter === "none"}
              onSelect={() => setFeedbackFilter("none")}
            >
              No feedback
            </ScopeFilterRow>
          </div>
        ),
      },
      {
        id: "checkout-platform",
        label: "Checkout channel",
        summary: checkoutPlatformSummary,
        panel: (
          <div className="space-y-0.5">
            <ScopeFilterRow
              selected={checkoutPlatform === "all"}
              onSelect={() => setCheckoutPlatform("all")}
            >
              Shopify & JUST
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={checkoutPlatform === "shopify"}
              onSelect={() => setCheckoutPlatform("shopify")}
            >
              Shopify checkout
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={checkoutPlatform === "just"}
              onSelect={() => setCheckoutPlatform("just")}
            >
              JUST (incl. redirect)
            </ScopeFilterRow>
          </div>
        ),
      },
      {
        id: "checkout-stage",
        label: "Checkout stage",
        summary: checkoutStageSummary,
        panel: (
          <div className="space-y-0.5">
            <ScopeFilterRow
              selected={checkoutStage === "all"}
              onSelect={() => setCheckoutStage("all")}
            >
              All stages
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={checkoutStage === "started"}
              onSelect={() => setCheckoutStage("started")}
            >
              Started
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={checkoutStage === "completed"}
              onSelect={() => setCheckoutStage("completed")}
            >
              Completed
            </ScopeFilterRow>
            <ScopeFilterRow
              selected={checkoutStage === "redirect"}
              onSelect={() => setCheckoutStage("redirect")}
            >
              JUST redirect to checkout
            </ScopeFilterRow>
          </div>
        ),
      },
    ];
  }, [device, launchSource, feedbackFilter, checkoutPlatform, checkoutStage]);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <p className="text-muted-foreground">
          Browse and filter all Ralph conversations
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DashboardScopeFilter
          shop={shop}
          onShopChange={setShop}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateRangeChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
          aboveScope={
            <>
              <ScopeFilterSection title="Search">
                <div className="px-2">
                  <Input
                    placeholder="Messages, shop, conversation ID…"
                    className="h-8 text-[13px]"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </ScopeFilterSection>
              <div className="flex items-center justify-between gap-3 px-2 py-1">
                <label
                  htmlFor="hide-empty"
                  className="cursor-pointer text-[13px] leading-snug select-none"
                >
                  Hide conversations with no messages
                </label>
                <Switch
                  id="hide-empty"
                  checked={hideEmpty}
                  onCheckedChange={setHideEmpty}
                />
              </div>
            </>
          }
          extraCategories={conversationFilterCategories}
        />
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          {loading ? (
            <>
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden
              />
              <span>Loading conversations…</span>
            </>
          ) : (
            `${allConversations.length} conversations`
          )}
        </span>
        {enriching && (
          <span className="text-xs">· Enriching checkout data...</span>
        )}
        {!enriching && enrichedCount > 0 && (
          <span className="text-xs">
            · {enrichedCount} with checkout activity
          </span>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Shop</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Launch</TableHead>
              <TableHead>Feedback</TableHead>
              <TableHead>Checkout</TableHead>
              <TableHead>Attribution</TableHead>
              <TableHead>End Reason</TableHead>
              <TableHead className="text-right">ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="pointer-events-none">
                  <TableCell className="w-8 px-2">
                    <Skeleton className="h-4 w-4 rounded" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))}
            {!loading &&
              pagedConversations.map((c) => {
                const enrichment = enrichments[c.conversationId];
                const isExpanded = expandedId === c.conversationId;
                return (
                  <Fragment key={c.conversationId}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => toggleExpand(c)}
                      data-state={isExpanded ? "selected" : undefined}
                    >
                      <TableCell className="w-8 px-2">
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {c.shopName}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.startedAt
                          ? format(new Date(c.startedAt), "MMM d, HH:mm")
                          : "—"}
                      </TableCell>
                      <TableCell>{c.messageCount}</TableCell>
                      <TableCell>
                        {c.device ? (
                          <Badge variant="outline">{c.device}</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {c.mode ? (
                          <Badge variant="secondary" className="capitalize">
                            {c.mode}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <LaunchIndicator source={c.launchSource} />
                      </TableCell>
                      <TableCell>
                        <ConversationFeedbackTableCell events={c.events} />
                      </TableCell>
                      <TableCell>
                        <CheckoutBadge enrichment={enrichment} />
                      </TableCell>
                      <TableCell>
                        <AttributionBadge
                          attribution={enrichment?.attribution ?? null}
                        />
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.endReason ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {c.conversationId.slice(0, 8)}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={12} className="p-0">
                          <div className="border-t bg-muted/20 px-6 py-4">
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-sm font-semibold">
                                Conversation
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {c.conversationId}
                              </span>
                              {enrichment?.hasCheckout && (
                                <CheckoutBadge enrichment={enrichment} />
                              )}
                            </div>
                            <Tabs defaultValue="chat" className="w-full">
                              <TabsList className="grid w-full max-w-md grid-cols-3">
                                <TabsTrigger value="chat">Chat</TabsTrigger>
                                <TabsTrigger value="journey">
                                  User Journey
                                </TabsTrigger>
                                <TabsTrigger value="attribution">
                                  Attribution
                                </TabsTrigger>
                              </TabsList>

                              <TabsContent value="chat">
                                <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-4">
                                  {c.events
                                    .filter(
                                      (e) =>
                                        e.eventType === "user_message" ||
                                        e.eventType === "assistant_message",
                                    )
                                    .map((e, i) => {
                                      const isUser =
                                        e.eventType === "user_message";
                                      const parsed = parseMessage(
                                        (e.data ?? {}) as Record<
                                          string,
                                          unknown
                                        >,
                                      );
                                      const displayText =
                                        parsed.text || JSON.stringify(e.data);
                                      const messageModeFromData = String(
                                        (e.data as Record<string, unknown>)
                                          .mode ?? "",
                                      ).trim();
                                      const messageModeLabel =
                                        messageModeFromData || (c.mode ?? "");
                                      const showRalphPayload =
                                        !isUser &&
                                        (parsed.recommendations.length > 0 ||
                                          parsed.links.length > 0 ||
                                          parsed.questions.length > 0 ||
                                          parsed.action != null);
                                      return (
                                        <div
                                          key={i}
                                          className={`rounded-lg p-3 text-sm ${
                                            isUser
                                              ? "ml-8 bg-primary text-primary-foreground"
                                              : "mr-8 bg-muted"
                                          }`}
                                        >
                                          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                                            <span>
                                              {isUser ? "User" : "Ralph"}{" "}
                                              &middot;{" "}
                                              {format(
                                                new Date(e.createdAt),
                                                "HH:mm:ss",
                                              )}
                                            </span>
                                            {isUser && messageModeLabel && (
                                              <Badge
                                                variant="secondary"
                                                className="h-5 px-1.5 text-[10px] font-normal capitalize opacity-90"
                                              >
                                                {messageModeLabel}
                                              </Badge>
                                            )}
                                            {!isUser && parsed.lang && (
                                              <Badge
                                                variant="outline"
                                                className="h-5 px-1.5 text-[10px] font-normal opacity-90"
                                              >
                                                {parsed.lang}
                                              </Badge>
                                            )}
                                          </div>
                                          <div className="whitespace-pre-wrap break-words">
                                            {displayText}
                                          </div>
                                          {showRalphPayload && (
                                            <div className="mt-2 space-y-3 border-t border-border/30 pt-2">
                                              {parsed.recommendations.length >
                                                0 && (
                                                <div className="space-y-1">
                                                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                    <Zap className="h-3 w-3" />
                                                    Recommendations
                                                  </div>
                                                  {parsed.recommendations.map(
                                                    (rec, ri) => (
                                                      <div
                                                        key={ri}
                                                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                                                      >
                                                        <span className="font-medium">
                                                          {rec.title}
                                                        </span>
                                                        {rec.price && (
                                                          <span className="text-muted-foreground">
                                                            {rec.price}
                                                          </span>
                                                        )}
                                                        {rec.compareAtPrice && (
                                                          <span className="text-muted-foreground line-through">
                                                            {rec.compareAtPrice}
                                                          </span>
                                                        )}
                                                      </div>
                                                    ),
                                                  )}
                                                </div>
                                              )}
                                              {parsed.links.length > 0 && (
                                                <div className="space-y-1">
                                                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                    <ExternalLink className="h-3 w-3" />
                                                    Links
                                                  </div>
                                                  <ul className="list-none space-y-1 pl-0">
                                                    {parsed.links.map(
                                                      (link, li) => (
                                                        <li key={li}>
                                                          <a
                                                            href={link.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                                                          >
                                                            <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                                                            {link.label ||
                                                              link.url}
                                                          </a>
                                                        </li>
                                                      ),
                                                    )}
                                                  </ul>
                                                </div>
                                              )}
                                              {parsed.questions.length > 0 && (
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                    <ListOrdered className="h-3 w-3" />
                                                    Questions
                                                  </div>
                                                  {parsed.questions.map(
                                                    (q, qi) => (
                                                      <div
                                                        key={qi}
                                                        className="rounded-md border border-border/40 bg-background/40 px-2 py-1.5"
                                                      >
                                                        {q.prompt && (
                                                          <p className="text-xs font-medium">
                                                            {q.prompt}
                                                          </p>
                                                        )}
                                                        {q.options.length >
                                                          0 && (
                                                          <div className="mt-1.5 flex flex-wrap gap-1">
                                                            {q.options.map(
                                                              (opt, oi) => (
                                                                <Badge
                                                                  key={oi}
                                                                  variant="secondary"
                                                                  className="text-[10px] font-normal"
                                                                >
                                                                  {opt}
                                                                </Badge>
                                                              ),
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    ),
                                                  )}
                                                </div>
                                              )}
                                              {parsed.action && (
                                                <div className="space-y-1">
                                                  <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                    <MousePointerClick className="h-3 w-3" />
                                                    Action
                                                  </div>
                                                  <div className="space-y-0.5 rounded-md border border-border/40 bg-background/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed">
                                                    {Object.entries(
                                                      parsed.action,
                                                    ).map(([k, v]) => (
                                                      <div key={k}>
                                                        <span className="text-muted-foreground">
                                                          {k}:
                                                        </span>{" "}
                                                        {typeof v ===
                                                          "object" && v !== null
                                                          ? JSON.stringify(v)
                                                          : String(v)}
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {!isUser && e.feedback ? (
                                            <MessageFeedbackDetail
                                              feedback={e.feedback}
                                            />
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  {c.events.filter(
                                    (e) =>
                                      e.eventType === "user_message" ||
                                      e.eventType === "assistant_message",
                                  ).length === 0 && (
                                    <div className="py-8 text-center text-sm text-muted-foreground">
                                      No messages in this conversation.
                                    </div>
                                  )}
                                </div>
                              </TabsContent>

                              <TabsContent value="journey">
                                <div className="max-h-[60vh] overflow-y-auto pr-4">
                                  <JourneyTimeline
                                    journey={journeys[c.conversationId]}
                                    loading={
                                      journeysBulkLoading &&
                                      journeys[c.conversationId] === undefined
                                    }
                                    conversationId={c.conversationId}
                                    onRetry={handleJourneyRetry}
                                    retryLoading={
                                      journeyRetryingId === c.conversationId
                                    }
                                  />
                                </div>
                              </TabsContent>

                              <TabsContent value="attribution">
                                <div className="max-h-[60vh] overflow-y-auto pr-4">
                                  <AttributionDetail enrichment={enrichment} />
                                </div>
                              </TabsContent>
                            </Tabs>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            {allConversations.length === 0 && !loading && (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="text-center text-muted-foreground"
                >
                  No conversations match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {!loading && allConversations.length > 0 && (
          <div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Page {conversationPage + 1} of {conversationPageCount}
              {" · "}
              Showing {conversationPage * CONVERSATIONS_PAGE_SIZE + 1}–
              {Math.min(
                (conversationPage + 1) * CONVERSATIONS_PAGE_SIZE,
                allConversations.length,
              )}{" "}
              of {allConversations.length}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={conversationPage <= 0}
                onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={conversationPage >= conversationPageCount - 1}
                onClick={() =>
                  setTablePage((p) =>
                    Math.min(conversationPageCount - 1, p + 1),
                  )
                }
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
