import { NextResponse } from "next/server";
import {
  runConversationPosthogBundle,
  type ConversationBundleKey,
} from "@/lib/conversation-posthog-bundle";
import { getPosthogRowCache } from "@/lib/posthog-row-cache";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const dateFrom = (body.dateFrom as string) ?? "2024-01-01";
    const dateTo = (body.dateTo as string) ?? "2099-12-31";

    const rawList = body.conversations as
      | Array<{
          conversationId: string;
          shopId: string;
          startedAt: string;
          posthogDistinctId?: string | null;
        }>
      | undefined;

    if (!rawList || rawList.length === 0) {
      return NextResponse.json({ journeys: {}, enrichments: {} });
    }

    const eventsByConversationId = (body.eventsByConversationId ??
      {}) as Record<string, Record<string, unknown>[]>;

    const conversationKeys: ConversationBundleKey[] = rawList.map((c) => ({
      conversationId: c.conversationId,
      shopId: c.shopId ?? "",
      startedAt: c.startedAt ?? "",
      posthogDistinctId: c.posthogDistinctId ?? undefined,
    }));

    const tokenRaw = body.posthogRowCacheToken;
    const token =
      typeof tokenRaw === "string" && tokenRaw.trim().length > 0
        ? tokenRaw.trim()
        : null;
    const cachedRows = token ? getPosthogRowCache(token) : null;

    const { journeys, enrichments } = await runConversationPosthogBundle({
      dateFrom,
      dateTo,
      conversationKeys,
      eventsByConversationId,
      prefetchedJourneyRows: cachedRows,
    });

    return NextResponse.json({ journeys, enrichments });
  } catch (err) {
    console.error("[API /conversations/posthog-bundle]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
