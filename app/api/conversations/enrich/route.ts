import { NextResponse } from "next/server";
import { queryPostHog } from "@/lib/posthog";
import { scanTable } from "@/lib/dynamo";
import type {
  CheckoutEvent,
  ConversationEnrichment,
  Attribution,
} from "@/lib/types";

function extractRecommendations(
  events: Record<string, unknown>[]
): string[] {
  const handles = new Set<string>();
  for (const evt of events) {
    if (evt.eventType !== "assistant_message") continue;
    const data = evt.data as Record<string, unknown> | undefined;
    if (!data) continue;

    for (const val of Object.values(data)) {
      if (typeof val !== "string") continue;
      let s = val.trim();
      if (s.startsWith("```")) {
        s = s.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
      }
      try {
        const parsed = JSON.parse(s);
        if (parsed?.recommendations && Array.isArray(parsed.recommendations)) {
          for (const r of parsed.recommendations) {
            const title = r.title ?? r.handle ?? "";
            if (title) handles.add(title);
          }
        }
      } catch {
        /* not JSON */
      }
    }
  }
  return [...handles];
}

function normalizeProduct(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüÿçœæ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBaseName(normalized: string): string {
  const colorWords = new Set([
    "noir", "blanc", "rouge", "bleu", "vert", "rose", "gris", "beige",
    "ocre", "bordeaux", "sapin", "ciel", "marine", "taupe", "leopard",
    "kaki", "dune", "poudre", "craie", "ivoire", "cappuccino", "absinthe",
    "fuchsia", "sangria", "sable", "canard", "camel", "or", "metal",
    "bronze", "argent", "deau", "fonce", "rayures",
  ]);
  const words = normalized.split(" ").filter((w) => !colorWords.has(w) && w.length > 0);
  return words.join(" ");
}

function productsMatch(recommended: string[], checkoutItems: string[]): boolean {
  if (recommended.length === 0 || checkoutItems.length === 0) return false;
  const normRecs = recommended.map(normalizeProduct);
  const baseRecs = normRecs.map(extractBaseName);

  return checkoutItems.some((item) => {
    const normItem = normalizeProduct(item);
    const baseItem = extractBaseName(normItem);
    return (
      normRecs.some((r) => r.includes(normItem) || normItem.includes(r)) ||
      baseRecs.some(
        (br) =>
          br.length > 3 &&
          baseItem.length > 3 &&
          (br.includes(baseItem) || baseItem.includes(br))
      )
    );
  });
}

function computeAttribution(
  firstRalphTs: string | null,
  firstCartTs: string | null,
  recommendations: string[],
  checkoutProducts: string[],
  hasJustRedirect: boolean,
  hasBuyClicked: boolean
): { attribution: Attribution; detail: string } {
  if (hasBuyClicked && hasJustRedirect) {
    if (recommendations.length > 0 && checkoutProducts.length === 0) {
      return { attribution: "direct", detail: "User clicked Buy in Ralph and was redirected to JUST checkout" };
    }
    if (productsMatch(recommendations, checkoutProducts)) {
      return { attribution: "direct", detail: "User clicked Buy in Ralph for a recommended product" };
    }
    return { attribution: "pdp_shortcut", detail: "User clicked Buy in Ralph for a product they were already viewing" };
  }

  if (hasJustRedirect && !hasBuyClicked) {
    if (recommendations.length > 0) {
      return { attribution: "direct", detail: "User was redirected to JUST checkout after Ralph interaction" };
    }
    return { attribution: "pdp_shortcut", detail: "JUST checkout redirect, no specific recommendation match" };
  }

  if (!firstRalphTs) {
    return { attribution: "unknown", detail: "No Ralph interaction timestamp found" };
  }

  const ralphTime = new Date(firstRalphTs).getTime();
  const cartTime = firstCartTs ? new Date(firstCartTs).getTime() : null;

  if (cartTime && cartTime < ralphTime) {
    if (productsMatch(recommendations, checkoutProducts)) {
      return { attribution: "reinforcement", detail: "Cart was built before Ralph, but Ralph recommended the same product family" };
    }
    return { attribution: "not_influenced", detail: "Cart was built before Ralph interaction, with different products" };
  }

  if (productsMatch(recommendations, checkoutProducts)) {
    return { attribution: "direct", detail: "User checked out with a product Ralph recommended" };
  }

  return { attribution: "not_influenced", detail: "Checkout products don't match Ralph's recommendations" };
}

async function resolveDistinctId(
  shopId: string,
  startedAt: string
): Promise<string | null> {
  const ts = new Date(startedAt);
  const offsetMs = 90_000;
  const beforeDate = new Date(ts.getTime() - offsetMs);
  const afterDate = new Date(ts.getTime() + offsetMs);

  const toParis = (d: Date) =>
    d.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace("T", " ");

  const beforeStr = toParis(beforeDate);
  const afterStr = toParis(afterDate);

  const result = await queryPostHog(`
    SELECT distinct_id, toUnixTimestamp(timestamp) AS unix_ts
    FROM events
    WHERE event = 'just_ai_session_started'
      AND JSONExtractString(properties, 'shopId') = '${shopId.replace(/'/g, "\\'")}'
      AND timestamp >= '${beforeStr}'
      AND timestamp <= '${afterStr}'
    ORDER BY timestamp ASC
    LIMIT 10
  `);

  if (result.results.length === 0) return null;

  const targetUnix = Math.floor(ts.getTime() / 1000);
  let best: { did: string; diff: number } | null = null;
  for (const row of result.results) {
    const did = row[0] as string;
    const unixTs = row[1] as number;
    const diff = Math.abs(unixTs - targetUnix);
    if (diff <= 60 && (!best || diff < best.diff)) {
      best = { did, diff };
    }
  }

  return best?.did ?? null;
}

interface ConversationKey {
  conversationId: string;
  shopId: string;
  startedAt: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const conversations: ConversationKey[] = body.conversations ?? [];

    if (conversations.length === 0) {
      return NextResponse.json({ enrichments: {} });
    }

    // Resolve distinct IDs for all conversations in parallel (limited concurrency)
    const resolved = new Map<string, { distinctId: string; key: ConversationKey }>();
    const batchSize = 10;
    for (let i = 0; i < conversations.length; i += batchSize) {
      const batch = conversations.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (c) => {
          if (!c.shopId || !c.startedAt) return null;
          const did = await resolveDistinctId(c.shopId, c.startedAt);
          if (did) return { conversationId: c.conversationId, distinctId: did, key: c };
          return null;
        })
      );
      for (const r of results) {
        if (r) resolved.set(r.conversationId, { distinctId: r.distinctId, key: r.key });
      }
    }

    if (resolved.size === 0) {
      const empty: Record<string, ConversationEnrichment> = {};
      for (const c of conversations) {
        empty[c.conversationId] = {
          hasCheckout: false,
          checkoutType: null,
          checkoutCompleted: false,
          checkoutEvents: [],
          attribution: null,
          attributionDetail: null,
          ralphRecommendations: [],
          checkoutProducts: [],
        };
      }
      return NextResponse.json({ enrichments: empty });
    }

    // Fetch checkout + Ralph action events from PostHog for all resolved distinct IDs
    const allDids = [...new Set([...resolved.values()].map((v) => v.distinctId))];
    const inClause = allDids.map((d) => `'${d.replace(/'/g, "\\'")}'`).join(",");

    const eventsResult = await queryPostHog(`
      SELECT
        distinct_id,
        event,
        timestamp,
        JSONExtractString(properties, 'shopId') AS shop_id,
        JSONExtractString(properties, 'data') AS data_json,
        JSONExtractString(properties, 'context') AS context_json
      FROM events
      WHERE (
        event IN (
          'shopify_checkout_started', 'shopify_checkout_completed',
          'just_checkout_started', 'just_checkout_completed',
          'just_ai_checkout_redirected', 'just_ai_buy_clicked',
          'shopify_product_added_to_cart'
        )
      )
        AND distinct_id IN (${inClause})
      ORDER BY distinct_id, timestamp
      LIMIT 50000
    `);

    // Group PostHog events by distinct_id
    const eventsByDid = new Map<string, Array<{
      event: string;
      timestamp: string;
      shopId: string | null;
      dataJson: string;
      ctxJson: string;
    }>>();

    for (const row of eventsResult.results) {
      const did = row[0] as string;
      if (!eventsByDid.has(did)) eventsByDid.set(did, []);
      eventsByDid.get(did)!.push({
        event: row[1] as string,
        timestamp: row[2] as string,
        shopId: row[3] as string | null,
        dataJson: row[4] as string,
        ctxJson: row[5] as string,
      });
    }

    // Fetch DynamoDB conversation events for recommendation extraction
    const convoItems = await scanTable("AiAgentConversationsProd");
    const convoMap = new Map<string, Record<string, unknown>[]>();
    for (const item of convoItems) {
      const cid = (item.conversationId as string) ?? "";
      if (!convoMap.has(cid)) convoMap.set(cid, []);
      convoMap.get(cid)!.push(item);
    }

    // Build enrichment for each conversation
    const enrichments: Record<string, ConversationEnrichment> = {};

    for (const conv of conversations) {
      const resolvedInfo = resolved.get(conv.conversationId);
      if (!resolvedInfo) {
        enrichments[conv.conversationId] = {
          hasCheckout: false,
          checkoutType: null,
          checkoutCompleted: false,
          checkoutEvents: [],
          attribution: null,
          attributionDetail: null,
          ralphRecommendations: [],
          checkoutProducts: [],
        };
        continue;
      }

      const did = resolvedInfo.distinctId;
      const rawEvents = eventsByDid.get(did) ?? [];

      const checkoutEvents: CheckoutEvent[] = [];
      const allLineItems: string[] = [];
      let firstCartTs: string | null = null;
      let hasJustRedirect = false;
      let hasBuyClicked = false;
      let hasJust = false;
      let hasShopify = false;
      let completed = false;

      for (const re of rawEvents) {
        if (re.event === "just_ai_buy_clicked") {
          hasBuyClicked = true;
          continue;
        }
        if (re.event === "shopify_product_added_to_cart") {
          if (!firstCartTs) firstCartTs = re.timestamp;
          try {
            const d = JSON.parse(re.dataJson || "{}");
            const title =
              d?.cartLine?.merchandise?.product?.title ??
              d?.productVariant?.product?.title;
            if (title && !allLineItems.includes(title)) allLineItems.push(title);
          } catch { /* ignore */ }
          continue;
        }
        if (re.event === "just_ai_checkout_redirected") {
          hasJustRedirect = true;
          continue;
        }

        if (re.event.startsWith("just_checkout")) hasJust = true;
        if (re.event.startsWith("shopify_checkout")) hasShopify = true;
        if (re.event.endsWith("_completed")) completed = true;

        let totalPrice: number | null = null;
        let orderId: string | null = null;
        let orderName: string | null = null;
        let currency: string | null = null;
        const lineItems: { title: string; quantity: number }[] = [];

        for (const jsonStr of [re.dataJson, re.ctxJson]) {
          if (!jsonStr) continue;
          try {
            const d = JSON.parse(jsonStr);
            const co = d.checkout ?? d;
            if (co.totalPrice) totalPrice = totalPrice ?? parseFloat(co.totalPrice);
            if (co.subtotalPrice?.amount) totalPrice = totalPrice ?? parseFloat(co.subtotalPrice.amount);
            orderId = orderId ?? co.orderId ?? d.orderId ?? null;
            orderName = orderName ?? co.orderName ?? d.orderName ?? null;
            currency = currency ?? co.currencyCode ?? d.currency ?? null;

            const items = co.lineItems ?? d.lineItems ?? [];
            for (const li of items) {
              if (li.title) {
                lineItems.push({ title: li.title, quantity: li.quantity ?? 1 });
                if (!allLineItems.includes(li.title)) allLineItems.push(li.title);
              }
            }
          } catch { /* ignore */ }
        }

        checkoutEvents.push({
          distinctId: did,
          event: re.event,
          timestamp: re.timestamp,
          shopId: re.shopId ?? conv.shopId,
          totalPrice,
          orderId,
          orderName,
          currency,
          lineItems: lineItems.length > 0 ? lineItems : undefined,
        });
      }

      const hasCheckout = checkoutEvents.length > 0 || hasBuyClicked || hasJustRedirect;

      let checkoutType: "just" | "shopify" | "both" | null = null;
      if (hasJust && hasShopify) checkoutType = "both";
      else if (hasJust || hasJustRedirect) checkoutType = "just";
      else if (hasShopify) checkoutType = "shopify";

      // Extract recommendations from DynamoDB conversation events
      const convoEvents = convoMap.get(conv.conversationId) ?? [];
      const recommendations = extractRecommendations(convoEvents);

      let attribution: Attribution | null = null;
      let attributionDetail: string | null = null;

      if (hasCheckout) {
        const result = computeAttribution(
          conv.startedAt,
          firstCartTs,
          recommendations,
          allLineItems,
          hasJustRedirect,
          hasBuyClicked
        );
        attribution = result.attribution;
        attributionDetail = result.detail;
      }

      enrichments[conv.conversationId] = {
        hasCheckout,
        checkoutType,
        checkoutCompleted: completed,
        checkoutEvents,
        attribution,
        attributionDetail,
        ralphRecommendations: recommendations,
        checkoutProducts: allLineItems,
      };
    }

    return NextResponse.json({ enrichments });
  } catch (err) {
    console.error("[API /conversations/enrich]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
