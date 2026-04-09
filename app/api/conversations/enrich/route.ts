import { NextResponse } from "next/server";
import { scanTable } from "@/lib/dynamo";
import {
  runEnrichmentsPipeline,
  type ConversationBundleKey,
} from "@/lib/conversation-posthog-bundle";

interface ConversationKey {
  conversationId: string;
  shopId: string;
  startedAt: string;
  posthogDistinctId?: string | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conversations: ConversationKey[] = body.conversations ?? [];

    if (conversations.length === 0) {
      return NextResponse.json({ enrichments: {} });
    }

    let eventsByConversationId = (body.eventsByConversationId ??
      null) as Record<string, Record<string, unknown>[]> | null;

    if (!eventsByConversationId || typeof eventsByConversationId !== "object") {
      const convoItems = await scanTable("AiAgentConversationsProd");
      const convoMap = new Map<string, Record<string, unknown>[]>();
      for (const item of convoItems) {
        const cid = (item.conversationId as string) ?? "";
        if (!convoMap.has(cid)) convoMap.set(cid, []);
        convoMap.get(cid)!.push(item);
      }
      eventsByConversationId = {};
      for (const c of conversations) {
        eventsByConversationId[c.conversationId] =
          convoMap.get(c.conversationId) ?? [];
      }
    }

    const conversationKeys: ConversationBundleKey[] = conversations.map(
      (c) => ({
        conversationId: c.conversationId,
        shopId: c.shopId,
        startedAt: c.startedAt,
        posthogDistinctId: c.posthogDistinctId,
      }),
    );

    const enrichments = await runEnrichmentsPipeline({
      conversationKeys,
      journeys: {},
      eventsByConversationId,
    });

    return NextResponse.json({ enrichments });
  } catch (err) {
    console.error("[API /conversations/enrich]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
