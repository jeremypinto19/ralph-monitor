import { NextResponse } from "next/server";
import { scanTable, resolveShopNames } from "@/lib/dynamo";
import { queryPostHog } from "@/lib/posthog";
import type {
  AiConversationEvent,
  AiConversation,
  AiConversationShopGroup,
  SourcePage,
} from "@/lib/types";

function sanitize(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") return val;
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
    if (path === "" || path === "/" || /^\/(en|fr|de|es|it)$/i.test(path)) return "homepage";
    if (/\/products\//i.test(path)) return "product";
    if (/\/collections/i.test(path)) return "collection";
    return "other";
  } catch {
    return "other";
  }
}

/** PostHog interprets bare datetime strings as Europe/Paris (project tz). */
function utcToParis(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace("T", " ");
}

function buildConversation(
  cid: string,
  events: AiConversationEvent[],
  shopId: string,
  sessionId: string | null
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
  const assistantMessages = events.filter((e) => e.eventType === "assistant_message");
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

    const items = await scanTable("AiAgentConversationsProd");

    const eventsByConvo = new Map<string, AiConversationEvent[]>();
    const convoShop = new Map<string, string>();
    const convoSession = new Map<string, string>();

    for (const item of items) {
      const cid = (item.conversationId as string) ?? "";
      const event: AiConversationEvent = {
        conversationId: cid,
        eventId: (item.eventId as string) ?? "",
        eventType: (item.eventType as string) ?? "",
        createdAt: (item.createdAt as string) ?? "",
        shopId: (item.shopId as string) ?? "",
        sessionId: (item.sessionId as string) ?? null,
        data: sanitize(item.data ?? {}) as Record<string, unknown>,
      };
      if (!eventsByConvo.has(cid)) eventsByConvo.set(cid, []);
      eventsByConvo.get(cid)!.push(event);
      convoShop.set(cid, event.shopId);
      if (event.sessionId) convoSession.set(cid, event.sessionId);
    }

    let conversations: AiConversation[] = [];
    for (const [cid, events] of eventsByConvo) {
      conversations.push(
        buildConversation(cid, events, convoShop.get(cid) ?? "", convoSession.get(cid) ?? null)
      );
    }

    conversations.sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

    if (shopFilter) {
      conversations = conversations.filter((c) => c.shopId === shopFilter);
    }
    if (dateFrom) {
      conversations = conversations.filter(
        (c) => c.startedAt && c.startedAt >= dateFrom
      );
    }
    if (dateTo) {
      const dateToEnd = dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;
      conversations = conversations.filter(
        (c) => c.startedAt && c.startedAt <= dateToEnd
      );
    }
    if (deviceFilter) {
      conversations = conversations.filter((c) => c.device === deviceFilter);
    }
    if (modeFilter) {
      conversations = conversations.filter((c) => c.mode === modeFilter);
    }

    const shopIds = [...new Set(conversations.map((c) => c.shopId))];
    const shopNames = await resolveShopNames(shopIds);

    // Resolve source page + device from PostHog session_started events
    if (conversations.length > 0 && dateFrom) {
      try {
        const phFrom = utcToParis(new Date(dateFrom));
        const phTo = utcToParis(dateTo ? new Date(dateTo.length === 10 ? `${dateTo}T23:59:59Z` : dateTo) : new Date("2099-12-31"));
        const shopClause = shopFilter
          ? `AND JSONExtractString(properties, 'shopId') = '${shopFilter.replace(/'/g, "\\'")}'`
          : "";

        // Query 1: just_ai_session_started for device, mode, and URL
        const result = await queryPostHog(`
          SELECT
            JSONExtractString(properties, 'shopId') AS shop_id,
            toString(toUnixTimestamp(timestamp)) AS unix_ts,
            properties.\`$current_url\` AS current_url,
            properties.\`$device_type\` AS device_type,
            JSONExtractString(properties, 'mode') AS mode
          FROM events
          WHERE event = 'just_ai_session_started'
            ${shopClause}
            AND timestamp >= '${phFrom}'
            AND timestamp <= '${phTo}'
          ORDER BY timestamp ASC
          LIMIT 50000
        `);

        const phEntries: { shopId: string; unixTs: number; url: string; deviceType: string | null; mode: string | null }[] = [];
        for (const row of result.results) {
          const sid = row[0] as string;
          const unixTs = parseInt(row[1] as string, 10);
          const url = (row[2] as string) || "";
          const deviceType = (row[3] as string) || null;
          const mode = (row[4] as string) || null;
          if (sid) phEntries.push({ shopId: sid, unixTs, url, deviceType, mode });
        }

        // Query 2: also fetch just_ai_widget_opened events which carry mode (search/product)
        const widgetResult = await queryPostHog(`
          SELECT
            JSONExtractString(properties, 'shopId') AS shop_id,
            toString(toUnixTimestamp(timestamp)) AS unix_ts,
            properties.\`$current_url\` AS current_url,
            JSONExtractString(properties, 'mode') AS mode
          FROM events
          WHERE event IN ('just_ai_widget_opened', 'just_ai_trigger_bar_expanded', 'just_ai_message_sent')
            ${shopClause}
            AND timestamp >= '${phFrom}'
            AND timestamp <= '${phTo}'
          ORDER BY timestamp ASC
          LIMIT 50000
        `);

        const widgetEntries: { shopId: string; unixTs: number; url: string; mode: string | null }[] = [];
        for (const row of widgetResult.results) {
          const sid = row[0] as string;
          const unixTs = parseInt(row[1] as string, 10);
          const url = (row[2] as string) || "";
          const mode = (row[3] as string) || null;
          if (sid) widgetEntries.push({ shopId: sid, unixTs, url, mode });
        }

        for (const conv of conversations) {
          if (!conv.startedAt) continue;
          const convUnix = Math.floor(new Date(conv.startedAt).getTime() / 1000);

          // Match against session_started events (±300s window)
          let bestMatch: { url: string; deviceType: string | null; mode: string | null; diff: number } | null = null;
          for (const entry of phEntries) {
            if (entry.shopId !== conv.shopId) continue;
            const diff = Math.abs(entry.unixTs - convUnix);
            if (diff <= 300 && (!bestMatch || diff < bestMatch.diff)) {
              bestMatch = { url: entry.url, deviceType: entry.deviceType, mode: entry.mode, diff };
            }
          }

          if (bestMatch) {
            if (bestMatch.url) conv.sourcePage = classifyUrl(bestMatch.url);
            if (!conv.device && bestMatch.deviceType) {
              conv.device = bestMatch.deviceType.toLowerCase();
            }
            if (!conv.mode && bestMatch.mode) {
              conv.mode = bestMatch.mode.toLowerCase();
            }
            if (!conv.mode && bestMatch.url) {
              conv.mode = /\/products\//i.test(bestMatch.url) ? "product" : "search";
            }
          }

          // If mode still missing, check widget/message events for a mode property
          if (!conv.mode) {
            let bestWidget: { url: string; mode: string | null; diff: number } | null = null;
            for (const entry of widgetEntries) {
              if (entry.shopId !== conv.shopId) continue;
              const diff = entry.unixTs - convUnix;
              if (diff >= -30 && diff <= 600 && (!bestWidget || diff < bestWidget.diff)) {
                bestWidget = { url: entry.url, mode: entry.mode, diff };
              }
            }
            if (bestWidget?.mode) {
              conv.mode = bestWidget.mode.toLowerCase();
            } else if (bestWidget?.url) {
              conv.mode = /\/products\//i.test(bestWidget.url) ? "product" : "search";
            }
          }
        }
      } catch (err) {
        console.error("[conversations] Failed to resolve PostHog enrichment:", err);
      }
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
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
