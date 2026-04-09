import { NextResponse } from "next/server";
import { queryPostHog } from "@/lib/posthog";
import { scanTable } from "@/lib/dynamo";
import type {
  CheckoutEvent,
  CheckoutUserGroup,
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") ?? "2024-01-01";
    const dateTo = searchParams.get("dateTo") ?? "2099-12-31";
    const shopId = searchParams.get("shopId") ?? "";

    const shopClause = shopId
      ? `AND JSONExtractString(properties, 'shopId') = '${shopId}'`
      : "";

    // Step 1: Get users who sent a message to Ralph
    const aiResult = await queryPostHog(`
      SELECT
        distinct_id,
        JSONExtractString(properties, 'shopId') AS shop_id,
        min(timestamp) AS first_ai_ts
      FROM events
      WHERE event = 'just_ai_message_sent'
        AND timestamp >= '${dateFrom}'
        AND timestamp <= '${dateTo}'
        ${shopClause}
      GROUP BY distinct_id, shop_id
      LIMIT 10000
    `);

    const aiUsers = new Map<string, { shopId: string; firstAiTs: string }>();
    for (const row of aiResult.results) {
      const did = row[0] as string;
      aiUsers.set(did, {
        shopId: row[1] as string,
        firstAiTs: row[2] as string,
      });
    }

    if (aiUsers.size === 0) {
      return NextResponse.json({ userGroups: [], totalRalphUsers: 0 });
    }

    const distinctIds = [...aiUsers.keys()];
    const inClause = distinctIds
      .map((d) => `'${d.replace(/'/g, "\\'")}'`)
      .join(",");

    // Step 2: Get all relevant events for these users (checkout + product + Ralph buy actions)
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
        AND timestamp >= '${dateFrom}'
        AND timestamp <= '${dateTo}'
      ORDER BY distinct_id, timestamp
      LIMIT 50000
    `);

    // Group events by user
    const userEvents = new Map<string, Array<{
      event: string;
      timestamp: string;
      shopId: string | null;
      dataJson: string;
      ctxJson: string;
    }>>();

    for (const row of eventsResult.results) {
      const did = row[0] as string;
      if (!userEvents.has(did)) userEvents.set(did, []);
      userEvents.get(did)!.push({
        event: row[1] as string,
        timestamp: row[2] as string,
        shopId: row[3] as string | null,
        dataJson: row[4] as string,
        ctxJson: row[5] as string,
      });
    }

    // Step 3: Fetch DynamoDB conversations to get recommendations
    const convoItems = await scanTable("AiAgentConversationsProd");
    const convosByShopTime = new Map<string, Record<string, unknown>[]>();
    for (const item of convoItems) {
      const sid = (item.shopId as string) ?? "";
      const createdAt = (item.createdAt as string) ?? "";
      const key = `${sid}|${createdAt.slice(0, 13)}`;
      if (!convosByShopTime.has(key)) convosByShopTime.set(key, []);
      convosByShopTime.get(key)!.push(item);
    }

    // Group conversations by conversationId for recommendation extraction
    const convoMap = new Map<string, Record<string, unknown>[]>();
    for (const item of convoItems) {
      const cid = (item.conversationId as string) ?? "";
      if (!convoMap.has(cid)) convoMap.set(cid, []);
      convoMap.get(cid)!.push(item);
    }

    // Step 4: For each user with checkout events, build enriched group
    const userGroups: CheckoutUserGroup[] = [];

    for (const [did, rawEvents] of userEvents) {
      const hasCheckout = rawEvents.some((e) =>
        e.event.includes("checkout") || e.event === "just_ai_buy_clicked"
      );
      if (!hasCheckout) continue;

      const ai = aiUsers.get(did);
      if (!ai) continue;

      // Parse checkout events
      const checkoutEvents: CheckoutEvent[] = [];
      const allLineItems: string[] = [];
      let customerName: string | null = null;
      let firstCartTs: string | null = null;
      let hasJustRedirect = false;
      let hasBuyClicked = false;

      for (const re of rawEvents) {
        if (re.event === "just_ai_buy_clicked") {
          hasBuyClicked = true;
          continue;
        }

        if (re.event === "shopify_product_added_to_cart") {
          if (!firstCartTs) firstCartTs = re.timestamp;
          // Extract product from cart event
          try {
            const d = JSON.parse(re.dataJson || "{}");
            const title =
              d?.cartLine?.merchandise?.product?.title ??
              d?.productVariant?.product?.title;
            if (title && !allLineItems.includes(title)) allLineItems.push(title);
          } catch { /* ignore */ }
          continue;
        }

        if (re.event === "just_ai_checkout_redirected") hasJustRedirect = true;

        let totalPrice: number | null = null;
        let orderId: string | null = null;
        let orderName: string | null = null;
        let currency: string | null = null;
        const lineItems: { title: string; quantity: number }[] = [];

        for (const jsonStr of [re.dataJson, re.ctxJson]) {
          if (!jsonStr) continue;
          try {
            const d = JSON.parse(jsonStr);

            if (!customerName && d.customer?.firstName) {
              customerName = `${d.customer.firstName} ${d.customer.lastName ?? ""}`.trim();
            }

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
          shopId: re.shopId ?? ai.shopId,
          totalPrice,
          orderId,
          orderName,
          currency,
          lineItems: lineItems.length > 0 ? lineItems : undefined,
        });
      }

      if (checkoutEvents.length === 0) continue;

      // Match DynamoDB conversations by shopId + timestamp proximity
      const ralphTs = new Date(ai.firstAiTs);
      const matchWindow = 90_000;
      const allRecs: string[] = [];

      for (const [cid, items] of convoMap) {
        const sameShop = items.some((i) => (i.shopId as string) === ai.shopId);
        if (!sameShop) continue;

        const startedItem = items.find(
          (i) => (i.eventType as string) === "conversation_started"
        );
        const ts = startedItem
          ? (startedItem.createdAt as string)
          : (items[0]?.createdAt as string) ?? "";
        if (!ts) continue;

        const convoTime = new Date(ts).getTime();
        const diff = Math.abs(convoTime - ralphTs.getTime());
        if (diff <= matchWindow) {
          const recs = extractRecommendations(
            items as unknown as Record<string, unknown>[]
          );
          allRecs.push(...recs);
        }
      }

      // Also try broader matching: all conversations for this shop within the date range
      // that are close to any Ralph event for this user
      if (allRecs.length === 0) {
        for (const [cid, items] of convoMap) {
          const sameShop = items.some((i) => (i.shopId as string) === ai.shopId);
          if (!sameShop) continue;

          for (const item of items) {
            const ts = item.createdAt as string;
            if (!ts) continue;
            const convoTime = new Date(ts).getTime();
            const diff = Math.abs(convoTime - ralphTs.getTime());
            if (diff <= 300_000) {
              const recs = extractRecommendations(
                items as unknown as Record<string, unknown>[]
              );
              allRecs.push(...recs);
              break;
            }
          }
        }
      }

      const uniqueRecs = [...new Set(allRecs)];

      const { attribution, detail } = computeAttribution(
        ai.firstAiTs,
        firstCartTs,
        uniqueRecs,
        allLineItems,
        hasJustRedirect,
        hasBuyClicked
      );

      userGroups.push({
        distinctId: did,
        customerName,
        shopId: ai.shopId,
        attribution,
        attributionDetail: detail,
        ralphRecommendations: uniqueRecs,
        checkoutProducts: allLineItems,
        firstRalphTs: ai.firstAiTs,
        events: checkoutEvents,
      });
    }

    userGroups.sort((a, b) => {
      const aTs = a.events[a.events.length - 1]?.timestamp ?? "";
      const bTs = b.events[b.events.length - 1]?.timestamp ?? "";
      return bTs.localeCompare(aTs);
    });

    return NextResponse.json({
      userGroups,
      totalRalphUsers: aiUsers.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
