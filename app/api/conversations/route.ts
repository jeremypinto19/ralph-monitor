import { NextResponse } from "next/server";
import {
  fetchUnifiedPosthogRowsByConversationIdsCached,
  loadAiAgentConversationItems,
  resolveShopNamesCached,
  type PhJustAiRow,
} from "@/lib/conversations-api-cache";
import { setPosthogRowCache } from "@/lib/posthog-row-cache";
import { parseSanitizedAssistantFeedback } from "@/lib/conversation-feedback";
import {
  conversationMatchesSourceModeFilter,
  parseConversationSourceModeFilter,
} from "@/lib/conversation-source-mode";
import type {
  AiConversationEvent,
  AiConversation,
  AiConversationShopGroup,
  ConversationLaunchSource,
  SourcePage,
} from "@/lib/types";

function sanitize(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (
    typeof val === "number" ||
    typeof val === "string" ||
    typeof val === "boolean"
  )
    return val;
  if (Array.isArray(val)) return val.map(sanitize);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = sanitize(v);
    }
    return out;
  }
  return String(val);
}

function classifyUrl(url: string): SourcePage {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    if (path === "" || path === "/" || /^\/(en|fr|de|es|it)$/i.test(path))
      return "homepage";
    if (/\/products\//i.test(path)) return "product";
    if (/\/collections/i.test(path)) return "collection";
    return "other";
  } catch {
    return "other";
  }
}

/** PostHog interprets bare datetime strings as Europe/Paris (project tz). */
function utcToParis(d: Date): string {
  return d
    .toLocaleString("sv-SE", { timeZone: "Europe/Paris" })
    .replace("T", " ");
}

function deriveLaunchSource(rows: PhJustAiRow[]): ConversationLaunchSource {
  let minShortcut = Number.POSITIVE_INFINITY;
  let minMessage = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (r.event === "just_ai_shortcut_clicked") {
      minShortcut = Math.min(minShortcut, r.tsUnix);
    }
    if (r.event === "just_ai_message_sent") {
      minMessage = Math.min(minMessage, r.tsUnix);
    }
  }
  if (!Number.isFinite(minShortcut) && !Number.isFinite(minMessage)) {
    return "unknown";
  }
  if (Number.isFinite(minShortcut) && !Number.isFinite(minMessage)) {
    return "shortcut";
  }
  if (!Number.isFinite(minShortcut) && Number.isFinite(minMessage)) {
    return "input";
  }
  return minShortcut <= minMessage ? "shortcut" : "input";
}

function applyPostHogRowsToConversations(
  conversations: AiConversation[],
  rows: PhJustAiRow[],
): void {
  const byCid = new Map<string, PhJustAiRow[]>();
  for (const r of rows) {
    if (!byCid.has(r.conversationId)) byCid.set(r.conversationId, []);
    byCid.get(r.conversationId)!.push(r);
  }

  for (const conv of conversations) {
    conv.launchSource = "unknown";
  }

  for (const conv of conversations) {
    const list = byCid.get(conv.conversationId);
    if (!list || list.length === 0) continue;

    let sessionUrl = "";
    let sessionDevice: string | null = null;
    let sessionMode: string | null = null;
    let firstUrl = "";
    let firstDevice: string | null = null;
    let firstMode: string | null = null;

    for (const r of list) {
      if (r.currentUrl && !firstUrl) firstUrl = r.currentUrl;
      if (r.deviceType && !firstDevice) firstDevice = r.deviceType;
      if (r.mode && !firstMode) firstMode = r.mode;

      if (r.event === "just_ai_session_started") {
        if (r.currentUrl && !sessionUrl) sessionUrl = r.currentUrl;
        if (r.deviceType && !sessionDevice) sessionDevice = r.deviceType;
        if (r.mode && !sessionMode) sessionMode = r.mode;
        if (r.distinctId && !conv.posthogDistinctId) {
          conv.posthogDistinctId = r.distinctId;
        }
      }
    }

    const urlForPage = sessionUrl || firstUrl;
    if (urlForPage) {
      conv.sourcePage = classifyUrl(urlForPage);
    }

    if (!conv.device) {
      const d = sessionDevice ?? firstDevice;
      if (d) conv.device = d.toLowerCase();
    }

    if (!conv.mode) {
      const m = sessionMode ?? firstMode;
      if (m) {
        conv.mode = m.toLowerCase();
      } else {
        const urlForMode = sessionUrl || firstUrl;
        if (urlForMode) {
          conv.mode = /\/products\//i.test(urlForMode) ? "product" : "search";
        }
      }
    }

    conv.launchSource = deriveLaunchSource(list);
  }
}

function buildConversation(
  cid: string,
  events: AiConversationEvent[],
  shopId: string,
  sessionId: string | null,
): AiConversation {
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let endReason: string | null = null;

  for (const e of events) {
    if (e.eventType === "conversation_started") startedAt = e.createdAt;
    if (e.eventType === "conversation_ended") {
      endedAt = e.createdAt;
      endReason = (e.data?.reason as string) ?? null;
    }
  }

  const userMessages = events.filter((e) => e.eventType === "user_message");
  const assistantMessages = events.filter(
    (e) => e.eventType === "assistant_message",
  );
  const toolCalls = events.filter((e) => e.eventType === "tool_call");

  let device: string | null = null;
  let mode: string | null = null;
  const startEvt = events.find((e) => e.eventType === "conversation_started");
  if (startEvt?.data) {
    device = (startEvt.data.device as string) ?? null;
    mode = (startEvt.data.mode as string) ?? null;
  }

  return {
    conversationId: cid,
    shopId,
    sessionId,
    startedAt: startedAt ?? events[0]?.createdAt ?? null,
    endedAt,
    endReason,
    events,
    messageCount: userMessages.length + assistantMessages.length,
    userMessages,
    assistantMessages,
    toolCalls,
    device,
    mode,
    sourcePage: null,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopFilter = searchParams.get("shopId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const deviceFilter = searchParams.get("device");
    const modeFilter = searchParams.get("mode");
    const sourceModeFilter = parseConversationSourceModeFilter(
      searchParams.get("sourceMode"),
    );
    const launchSourceFilter = searchParams.get("launchSource");

    const items = await loadAiAgentConversationItems();

    const eventsByConvo = new Map<string, AiConversationEvent[]>();
    const convoShop = new Map<string, string>();
    const convoSession = new Map<string, string>();

    for (const item of items) {
      const cid = (item.conversationId as string) ?? "";
      const feedback =
        item.feedback != null
          ? parseSanitizedAssistantFeedback(sanitize(item.feedback))
          : undefined;
      const event: AiConversationEvent = {
        conversationId: cid,
        eventId: (item.eventId as string) ?? "",
        eventType: (item.eventType as string) ?? "",
        createdAt: (item.createdAt as string) ?? "",
        shopId: (item.shopId as string) ?? "",
        sessionId: (item.sessionId as string) ?? null,
        data: sanitize(item.data ?? {}) as Record<string, unknown>,
        ...(feedback ? { feedback } : {}),
      };
      if (!eventsByConvo.has(cid)) eventsByConvo.set(cid, []);
      eventsByConvo.get(cid)!.push(event);
      convoShop.set(cid, event.shopId);
      if (event.sessionId) convoSession.set(cid, event.sessionId);
    }

    let conversations: AiConversation[] = [];
    for (const [cid, events] of eventsByConvo) {
      conversations.push(
        buildConversation(
          cid,
          events,
          convoShop.get(cid) ?? "",
          convoSession.get(cid) ?? null,
        ),
      );
    }

    conversations.sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );

    if (shopFilter) {
      conversations = conversations.filter((c) => c.shopId === shopFilter);
    }
    if (dateFrom) {
      conversations = conversations.filter(
        (c) => c.startedAt && c.startedAt >= dateFrom,
      );
    }
    if (dateTo) {
      const dateToEnd =
        dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;
      conversations = conversations.filter(
        (c) => c.startedAt && c.startedAt <= dateToEnd,
      );
    }
    if (deviceFilter) {
      conversations = conversations.filter((c) => c.device === deviceFilter);
    }

    const shopIds = [...new Set(conversations.map((c) => c.shopId))];
    const shopNames = await resolveShopNamesCached(shopIds);

    let posthogRowCacheToken: string | null = null;

    // PostHog: unified journey-shaped query feeds list enrichment + posthog-bundle cache
    if (conversations.length > 0 && dateFrom) {
      try {
        const phFrom = utcToParis(new Date(dateFrom));
        const phTo = utcToParis(
          dateTo
            ? new Date(dateTo.length === 10 ? `${dateTo}T23:59:59Z` : dateTo)
            : new Date("2099-12-31"),
        );
        const { justAiRows, allRawRows } =
          await fetchUnifiedPosthogRowsByConversationIdsCached(
            conversations.map((c) => c.conversationId),
            shopFilter,
            phFrom,
            phTo,
          );
        applyPostHogRowsToConversations(conversations, justAiRows);
        if (allRawRows.length > 0) {
          posthogRowCacheToken = setPosthogRowCache(allRawRows);
        }
      } catch (err) {
        console.error(
          "[conversations] Failed to resolve PostHog enrichment:",
          err,
        );
      }
    }

    if (launchSourceFilter && launchSourceFilter !== "all") {
      conversations = conversations.filter((c) => {
        const resolved = c.launchSource ?? "unknown";
        return resolved === launchSourceFilter;
      });
    }

    if (modeFilter) {
      conversations = conversations.filter((c) => c.mode === modeFilter);
    }
    if (sourceModeFilter !== "all") {
      conversations = conversations.filter((c) =>
        conversationMatchesSourceModeFilter(c.mode, sourceModeFilter),
      );
    }

    const groups: AiConversationShopGroup[] = [];
    const byShop = new Map<string, AiConversation[]>();
    for (const c of conversations) {
      if (!byShop.has(c.shopId)) byShop.set(c.shopId, []);
      byShop.get(c.shopId)!.push(c);
    }
    for (const [sid, convos] of byShop) {
      groups.push({
        shopId: sid,
        shopName: shopNames[sid] ?? sid.slice(0, 8),
        conversations: convos,
      });
    }

    return NextResponse.json({
      groups,
      totalConversations: conversations.length,
      totalEvents: items.length,
      posthogRowCacheToken,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
