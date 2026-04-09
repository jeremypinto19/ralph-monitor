import { NextResponse } from "next/server";
import { queryPostHog } from "@/lib/posthog";
import { scanTable, resolveShopNames } from "@/lib/dynamo";
import type { InsightsData } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") ?? "2024-01-01";
    const dateTo = searchParams.get("dateTo") ?? "2099-12-31";

    const items = await scanTable("AiAgentConversationsProd");

    const convoMap = new Map<
      string,
      { shopId: string; startedAt: string; device: string | null; mode: string | null; msgCount: number }
    >();

    for (const item of items) {
      const cid = item.conversationId as string;
      const eventType = item.eventType as string;
      const createdAt = item.createdAt as string;
      const shopId = item.shopId as string;

      if (!convoMap.has(cid)) {
        const data = (item.data ?? {}) as Record<string, unknown>;
        convoMap.set(cid, {
          shopId,
          startedAt: createdAt,
          device: eventType === "conversation_started" ? (data.device as string) ?? null : null,
          mode: eventType === "conversation_started" ? (data.mode as string) ?? null : null,
          msgCount: 0,
        });
      }

      const c = convoMap.get(cid)!;
      if (eventType === "conversation_started") {
        c.startedAt = createdAt;
        const data = (item.data ?? {}) as Record<string, unknown>;
        c.device = (data.device as string) ?? c.device;
        c.mode = (data.mode as string) ?? c.mode;
      }
      if (createdAt < c.startedAt) c.startedAt = createdAt;
      if (eventType === "user_message" || eventType === "assistant_message") {
        c.msgCount++;
      }
    }

    let convos = [...convoMap.values()];
    const dateToEnd = dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;
    convos = convos.filter((c) => c.startedAt >= dateFrom && c.startedAt <= dateToEnd);

    const totalConversations = convos.length;
    const conversationsWithMessages = convos.filter((c) => c.msgCount > 0).length;
    const totalMessages = convos.reduce((s, c) => s + c.msgCount, 0);
    const avgMessagesPerConversation = totalConversations > 0 ? totalMessages / totalConversations : 0;
    const activeShops = new Set(convos.map((c) => c.shopId)).size;

    const deviceBreakdown: Record<string, number> = {};
    const modeBreakdown: Record<string, number> = {};
    const conversationsByShop: Record<string, number> = {};

    for (const c of convos) {
      deviceBreakdown[c.device ?? "unknown"] = (deviceBreakdown[c.device ?? "unknown"] ?? 0) + 1;
      modeBreakdown[c.mode ?? "unknown"] = (modeBreakdown[c.mode ?? "unknown"] ?? 0) + 1;
      conversationsByShop[c.shopId] = (conversationsByShop[c.shopId] ?? 0) + 1;
    }

    const volumeMap = new Map<string, number>();
    for (const c of convos) {
      const day = c.startedAt.slice(0, 10);
      volumeMap.set(day, (volumeMap.get(day) ?? 0) + 1);
    }
    const volumeOverTime = [...volumeMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Avg messages per conversation per day (only conversations with ≥1 message)
    const avgMsgMap = new Map<string, { total: number; count: number }>();
    for (const c of convos) {
      if (c.msgCount === 0) continue;
      const day = c.startedAt.slice(0, 10);
      const entry = avgMsgMap.get(day) ?? { total: 0, count: 0 };
      entry.total += c.msgCount;
      entry.count++;
      avgMsgMap.set(day, entry);
    }
    const avgMessagesOverTime = [...avgMsgMap.entries()]
      .map(([date, { total, count }]) => ({
        date,
        count: Math.round((total / count) * 10) / 10,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Distribution: how many conversations have N messages
    const msgBuckets: Record<number, number> = {};
    for (const c of convos) {
      if (c.msgCount === 0) continue;
      msgBuckets[c.msgCount] = (msgBuckets[c.msgCount] ?? 0) + 1;
    }
    const messageDistribution = Object.entries(msgBuckets)
      .map(([msgs, cnt]) => ({
        name: `${msgs} msg${Number(msgs) > 1 ? "s" : ""}`,
        value: cnt,
        _sort: Number(msgs),
      }))
      .sort((a, b) => a._sort - b._sort)
      .map(({ name, value }) => ({ name, value }));

    const checkoutResult = await queryPostHog(`
      SELECT COUNT(DISTINCT distinct_id)
      FROM events
      WHERE event IN (
        'shopify_checkout_started',
        'shopify_checkout_completed',
        'just_checkout_completed',
        'just_ai_checkout_redirected'
      )
        AND distinct_id IN (
          SELECT DISTINCT distinct_id
          FROM events
          WHERE event LIKE 'just_ai_%'
            AND timestamp >= '${dateFrom}'
            AND timestamp <= '${dateTo}'
        )
        AND timestamp >= '${dateFrom}'
        AND timestamp <= '${dateTo}'
    `);

    const conversationsWithCheckout =
      checkoutResult.results?.[0]?.[0] != null
        ? Number(checkoutResult.results[0][0])
        : 0;
    const checkoutRate = totalConversations > 0 ? conversationsWithCheckout / totalConversations : 0;

    const shopIds = Object.keys(conversationsByShop);
    const shopNames = await resolveShopNames(shopIds);

    const topShops = Object.entries(conversationsByShop)
      .map(([id, count]) => ({ shopId: id, shopName: shopNames[id] ?? id.slice(0, 8), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const data: InsightsData = {
      totalConversations,
      conversationsWithMessages,
      totalMessages,
      avgMessagesPerConversation: Math.round(avgMessagesPerConversation * 10) / 10,
      deviceBreakdown,
      modeBreakdown,
      conversationsWithCheckout,
      checkoutRate: Math.round(checkoutRate * 1000) / 10,
      checkoutCompletedClassic: 0,
      checkoutCompletedJust: 0,
      activeShops,
      volumeOverTime,
      avgMessagesOverTime,
      messageDistribution,
      topShops,
      conversationsByShop,
    };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
