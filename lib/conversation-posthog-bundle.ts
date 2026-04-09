/**
 * Shared PostHog logic for conversation journeys + checkout enrichments
 * (batch journey HogQL, batched distinct_id resolve, single checkout query).
 */

import { queryPostHog } from "@/lib/posthog";
import type {
  Attribution,
  CheckoutEvent,
  ConversationEnrichment,
} from "@/lib/types";

// --- Journey (from user-journey) ---

export const EVENT_LABELS: Record<string, string> = {
  just_ai_trigger_bar_expanded: "Opened trigger bar",
  just_ai_session_started: "Session started",
  just_ai_widget_opened: "Widget opened",
  just_ai_widget_closed: "Widget closed",
  just_ai_message_sent: "User sent message",
  just_ai_message_received: "Ralph replied",
  just_ai_shortcut_clicked: "Clicked shortcut",
  just_ai_shuffle_clicked: "Shuffled results",
  just_ai_recommendation_clicked: "Clicked recommendation",
  just_ai_product_focused: "Focused on product",
  just_ai_buy_clicked: "Clicked Buy",
  just_ai_checkout_redirected: "Redirected to JUST checkout",
  just_ai_pdp_shortcut_shown: "PDP shortcut shown",
  just_pay_button_clicked: "Clicked JUST pay button",
  shopify_checkout_started: "Shopify checkout started",
  shopify_checkout_completed: "Shopify checkout completed",
  just_checkout_started: "JUST checkout started",
  just_checkout_completed: "JUST checkout completed",
};

interface TimelineStep {
  time: string;
  event: string;
  details: string;
}

export interface BundleJourneyJson {
  summary: string;
  timeline: {
    time: string;
    event: string;
    rawEvent: string;
    details: string;
  }[];
  totalEvents: number;
  resolved: boolean;
  resolvedDistinctId?: string;
}

function extractDetails(event: string, dataJson: string): string {
  if (!dataJson) return "";
  try {
    const data = JSON.parse(dataJson);
    switch (event) {
      case "just_ai_shortcut_clicked":
        return data.label ? `"${data.label}" (${data.source ?? "widget"})` : "";
      case "just_ai_message_sent":
        return data.mode ? `Mode: ${data.mode}` : "";
      case "just_ai_message_received":
        return [
          data.mode && `Mode: ${data.mode}`,
          data.recommendationCount != null &&
            `${data.recommendationCount} recommendations`,
        ]
          .filter(Boolean)
          .join(" · ");
      case "just_ai_product_focused":
      case "just_ai_recommendation_clicked":
        return data.handle ?? "";
      case "just_ai_buy_clicked":
        return [
          data.quantity && `qty: ${data.quantity}`,
          data.variantId && `variant: ${data.variantId.split("/").pop()}`,
        ]
          .filter(Boolean)
          .join(" · ");
      case "just_ai_checkout_redirected":
        return data.variantId
          ? `variant: ${data.variantId.split("/").pop()}`
          : "";
      default:
        return "";
    }
  } catch {
    return "";
  }
}

function generateSummary(steps: TimelineStep[], durationSec: number): string {
  const parts: string[] = [];

  const hasShortcut = steps.find((s) => s.event === "just_ai_shortcut_clicked");
  const products = steps.filter((s) => s.event === "just_ai_product_focused");
  const recos = steps.filter(
    (s) => s.event === "just_ai_recommendation_clicked",
  );
  const msgsSent = steps.filter((s) => s.event === "just_ai_message_sent");
  const msgsReceived = steps.filter(
    (s) => s.event === "just_ai_message_received",
  );
  const buyClicked = steps.some((s) => s.event === "just_ai_buy_clicked");
  const justRedirect = steps.some(
    (s) => s.event === "just_ai_checkout_redirected",
  );
  const shopifyStarted = steps.some(
    (s) => s.event === "shopify_checkout_started",
  );
  const shopifyCompleted = steps.some(
    (s) => s.event === "shopify_checkout_completed",
  );
  const justCompleted = steps.some(
    (s) => s.event === "just_checkout_completed",
  );

  if (hasShortcut) {
    parts.push(
      `User opened Ralph via the "${hasShortcut.details.replace(/"/g, "").split("(")[0].trim()}" shortcut`,
    );
  } else {
    parts.push("User opened Ralph");
  }

  const exchanges = Math.min(msgsSent.length, msgsReceived.length);
  if (exchanges > 0) {
    parts.push(
      `had ${exchanges} exchange${exchanges > 1 ? "s" : ""} with Ralph`,
    );
  }

  if (products.length > 0) {
    const handles = products.map((p) => p.details).filter(Boolean);
    if (handles.length > 0) {
      parts.push(
        `browsed ${handles.length === 1 ? `product "${handles[0]}"` : `${handles.length} products`}`,
      );
    }
  }

  if (recos.length > 0) {
    parts.push(
      `clicked ${recos.length} recommendation${recos.length > 1 ? "s" : ""}`,
    );
  }

  if (buyClicked && justRedirect) {
    parts.push("clicked Buy and was redirected to JUST checkout");
  } else if (buyClicked) {
    parts.push("clicked Buy");
  } else if (shopifyStarted) {
    parts.push("started Shopify checkout");
  }

  if (justCompleted) {
    parts.push("completed purchase via JUST");
  } else if (shopifyCompleted) {
    parts.push("completed purchase via Shopify");
  }

  const durationLabel =
    durationSec < 60
      ? `${Math.round(durationSec)}s`
      : `${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`;
  parts.push(`(total: ${durationLabel})`);

  if (parts.length <= 2) return parts.join(" ");

  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1);
  return `${first}, ${middle.join(", ")} ${last}`;
}

export const JOURNEY_EVENTS_FILTER = `(startsWith(event, 'just_ai_')
        OR event = 'just_pay_button_clicked'
        OR event IN (
          'shopify_checkout_started', 'shopify_checkout_completed',
          'just_checkout_started', 'just_checkout_completed'
        ))`;

/** Just AI events store ids/mode on `properties.data`, not at the root. */
export const HOGQL_DATA_CONVERSATION_ID =
  "JSONExtractString(properties, 'data', 'conversationId')";
export const HOGQL_DATA_MODE = "JSONExtractString(properties, 'data', 'mode')";

export function hogqlQuote(val: string): string {
  return `'${val.replace(/'/g, "\\'")}'`;
}

export const JOURNEY_MAX_EVENTS_PER_CONVERSATION = 500;
export const JOURNEY_BATCH_MAX_IDS = 120;
/** HogQL LIMIT per batch for journey-shaped queries (list + bundle). */
export const JOURNEY_BATCH_QUERY_ROW_CAP = 50_000;
const DISTINCT_ID_IN_BATCH = 100;
const CHECKOUT_ROW_LIMIT = 50_000;

function stepFromBatchRow(row: unknown[]): TimelineStep {
  const event = row[1] as string;
  return {
    time: row[2] as string,
    event,
    details: extractDetails(event, row[3] as string),
  };
}

/**
 * Build journey payloads from raw HogQL rows (same column order as handleBatchJourneys:
 * conversation_id, event, timestamp, data_json, distinct_id; extra trailing columns allowed).
 */
export function buildJourneysFromRawRows(
  results: unknown[][],
  conversationIds: string[],
): Record<string, BundleJourneyJson> {
  const journeys: Record<string, BundleJourneyJson> = {};
  if (conversationIds.length === 0) return journeys;

  const capped = conversationIds.slice(0, JOURNEY_BATCH_MAX_IDS);
  const byCid = new Map<string, TimelineStep[]>();
  const distinctByCid = new Map<string, string>();
  for (const row of results) {
    const cid = row[0] as string;
    if (!cid) continue;
    const did = row[4] as string;
    if (did && !distinctByCid.has(cid)) distinctByCid.set(cid, did);

    if (!byCid.has(cid)) byCid.set(cid, []);
    const list = byCid.get(cid)!;
    if (list.length >= JOURNEY_MAX_EVENTS_PER_CONVERSATION) continue;
    list.push(stepFromBatchRow(row));
  }

  for (const cid of capped) {
    const steps = byCid.get(cid) ?? [];
    journeys[cid] = buildJourneyJson(
      steps,
      distinctByCid.get(cid) ?? undefined,
    );
  }

  return journeys;
}

export function buildJourneyJson(
  steps: TimelineStep[],
  resolvedDistinctId?: string,
): BundleJourneyJson {
  let durationSec = 0;
  if (steps.length >= 2) {
    const first = new Date(steps[0].time).getTime();
    const last = new Date(steps[steps.length - 1].time).getTime();
    durationSec = (last - first) / 1000;
  }

  const summary =
    steps.length > 0 ? generateSummary(steps, durationSec) : "No events found.";

  const timeline = steps.map((s) => ({
    time: s.time,
    event:
      EVENT_LABELS[s.event] ??
      s.event.replace(/^just_ai_/, "").replace(/_/g, " "),
    rawEvent: s.event,
    details: s.details,
  }));

  return {
    summary,
    timeline,
    totalEvents: steps.length,
    resolved: true,
    ...(resolvedDistinctId ? { resolvedDistinctId } : {}),
  };
}

export async function handleBatchJourneys(
  conversationIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, BundleJourneyJson>> {
  if (conversationIds.length === 0) return {};

  const capped = conversationIds.slice(0, JOURNEY_BATCH_MAX_IDS);
  const dateFromQ = hogqlQuote(dateFrom);
  const dateToQ = hogqlQuote(dateTo);
  const inList = capped.map(hogqlQuote).join(", ");

  const eventsResult = await queryPostHog(`
    SELECT
      ${HOGQL_DATA_CONVERSATION_ID} AS conversation_id,
      event,
      timestamp,
      JSONExtractString(properties, 'data') AS data_json,
      distinct_id
    FROM events
    WHERE ${HOGQL_DATA_CONVERSATION_ID} IN (${inList})
      AND ${JOURNEY_EVENTS_FILTER}
      AND timestamp >= ${dateFromQ}
      AND timestamp <= ${dateToQ}
    ORDER BY conversation_id, timestamp ASC
    LIMIT ${JOURNEY_BATCH_QUERY_ROW_CAP}
  `);

  return buildJourneysFromRawRows(eventsResult.results, conversationIds);
}

// --- Enrichment (from enrich) ---

export function extractRecommendations(
  events: Record<string, unknown>[],
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
        s = s
          .replace(/^```\w*\n?/, "")
          .replace(/\n?```$/, "")
          .trim();
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
    "noir",
    "blanc",
    "rouge",
    "bleu",
    "vert",
    "rose",
    "gris",
    "beige",
    "ocre",
    "bordeaux",
    "sapin",
    "ciel",
    "marine",
    "taupe",
    "leopard",
    "kaki",
    "dune",
    "poudre",
    "craie",
    "ivoire",
    "cappuccino",
    "absinthe",
    "fuchsia",
    "sangria",
    "sable",
    "canard",
    "camel",
    "or",
    "metal",
    "bronze",
    "argent",
    "deau",
    "fonce",
    "rayures",
  ]);
  const words = normalized
    .split(" ")
    .filter((w) => !colorWords.has(w) && w.length > 0);
  return words.join(" ");
}

function productsMatch(
  recommended: string[],
  checkoutItems: string[],
): boolean {
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
          (br.includes(baseItem) || baseItem.includes(br)),
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
  hasBuyClicked: boolean,
): { attribution: Attribution; detail: string } {
  if (hasBuyClicked && hasJustRedirect) {
    if (recommendations.length > 0 && checkoutProducts.length === 0) {
      return {
        attribution: "direct",
        detail: "User clicked Buy in Ralph and was redirected to JUST checkout",
      };
    }
    if (productsMatch(recommendations, checkoutProducts)) {
      return {
        attribution: "direct",
        detail: "User clicked Buy in Ralph for a recommended product",
      };
    }
    return {
      attribution: "pdp_shortcut",
      detail:
        "User clicked Buy in Ralph for a product they were already viewing",
    };
  }

  if (hasJustRedirect && !hasBuyClicked) {
    if (recommendations.length > 0) {
      return {
        attribution: "direct",
        detail: "User was redirected to JUST checkout after Ralph interaction",
      };
    }
    return {
      attribution: "pdp_shortcut",
      detail: "JUST checkout redirect, no specific recommendation match",
    };
  }

  if (!firstRalphTs) {
    return {
      attribution: "unknown",
      detail: "No Ralph interaction timestamp found",
    };
  }

  const ralphTime = new Date(firstRalphTs).getTime();
  const cartTime = firstCartTs ? new Date(firstCartTs).getTime() : null;

  if (cartTime && cartTime < ralphTime) {
    if (productsMatch(recommendations, checkoutProducts)) {
      return {
        attribution: "reinforcement",
        detail:
          "Cart was built before Ralph, but Ralph recommended the same product family",
      };
    }
    return {
      attribution: "not_influenced",
      detail:
        "Cart was built before Ralph interaction, with different products",
    };
  }

  if (productsMatch(recommendations, checkoutProducts)) {
    return {
      attribution: "direct",
      detail: "User checked out with a product Ralph recommended",
    };
  }

  return {
    attribution: "not_influenced",
    detail: "Checkout products don't match Ralph's recommendations",
  };
}

export async function resolveDistinctIdByShopAndTime(
  shopId: string,
  startedAt: string,
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

/**
 * One HogQL query: earliest distinct_id per conversationId from session_started.
 */
export async function batchResolveDistinctIdsByConversationId(
  conversationIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += DISTINCT_ID_IN_BATCH) {
    const batch = ids.slice(i, i + DISTINCT_ID_IN_BATCH);
    const inList = batch.map(hogqlQuote).join(", ");

    const result = await queryPostHog(`
      SELECT
        ${HOGQL_DATA_CONVERSATION_ID} AS cid,
        argMin(distinct_id, timestamp) AS did
      FROM events
      WHERE event = 'just_ai_session_started'
        AND ${HOGQL_DATA_CONVERSATION_ID} IN (${inList})
      GROUP BY cid
    `);

    for (const row of result.results) {
      const cid = row[0] as string;
      const did = row[1] as string;
      if (cid && did) out.set(cid, did);
    }
  }

  return out;
}

export type ConversationBundleKey = {
  conversationId: string;
  shopId: string;
  startedAt: string;
  posthogDistinctId?: string | null;
};

type RawPhEvent = {
  event: string;
  timestamp: string;
  shopId: string | null;
  dataJson: string;
  ctxJson: string;
};

export async function fetchCheckoutEventsByDistinctIds(
  distinctIds: string[],
): Promise<Map<string, RawPhEvent[]>> {
  const eventsByDid = new Map<string, RawPhEvent[]>();
  const unique = [...new Set(distinctIds.filter(Boolean))];
  if (unique.length === 0) return eventsByDid;

  const inClause = unique.map((d) => `'${d.replace(/'/g, "\\'")}'`).join(",");

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
    LIMIT ${CHECKOUT_ROW_LIMIT}
  `);

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

  return eventsByDid;
}

function emptyEnrichment(): ConversationEnrichment {
  return {
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

function buildOneEnrichment(
  conv: ConversationBundleKey,
  did: string,
  rawEvents: RawPhEvent[],
  recommendations: string[],
): ConversationEnrichment {
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
      } catch {
        /* ignore */
      }
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
        if (co.subtotalPrice?.amount)
          totalPrice = totalPrice ?? parseFloat(co.subtotalPrice.amount);
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
      } catch {
        /* ignore */
      }
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

  const hasCheckout =
    checkoutEvents.length > 0 || hasBuyClicked || hasJustRedirect;

  let checkoutType: "just" | "shopify" | "both" | null = null;
  if (hasJust && hasShopify) checkoutType = "both";
  else if (hasJust || hasJustRedirect) checkoutType = "just";
  else if (hasShopify) checkoutType = "shopify";

  let attribution: Attribution | null = null;
  let attributionDetail: string | null = null;

  if (hasCheckout) {
    const result = computeAttribution(
      conv.startedAt,
      firstCartTs,
      recommendations,
      allLineItems,
      hasJustRedirect,
      hasBuyClicked,
    );
    attribution = result.attribution;
    attributionDetail = result.detail;
  }

  return {
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

/**
 * Resolve distinct_id per conversation: hint → journey → batch session_started → shop/time fallback (bounded parallel).
 */
export async function resolveDistinctIdsForBundle(
  keys: ConversationBundleKey[],
  journeys: Record<string, BundleJourneyJson>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  for (const k of keys) {
    const hint = k.posthogDistinctId?.trim();
    if (hint) {
      resolved.set(k.conversationId, hint);
      continue;
    }
    const j = journeys[k.conversationId];
    const fromJourney = j?.resolvedDistinctId?.trim();
    if (fromJourney) {
      resolved.set(k.conversationId, fromJourney);
    }
  }

  const missingForBatch = keys
    .map((k) => k.conversationId)
    .filter((cid) => !resolved.has(cid));

  if (missingForBatch.length > 0) {
    const batchMap =
      await batchResolveDistinctIdsByConversationId(missingForBatch);
    for (const cid of missingForBatch) {
      const did = batchMap.get(cid);
      if (did) resolved.set(cid, did);
    }
  }

  const stillMissing = keys.filter((k) => !resolved.has(k.conversationId));
  const FALLBACK_CONCURRENCY = 8;
  for (let i = 0; i < stillMissing.length; i += FALLBACK_CONCURRENCY) {
    const chunk = stillMissing.slice(i, i + FALLBACK_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (k) => {
        if (!k.shopId || !k.startedAt) return null;
        const did = await resolveDistinctIdByShopAndTime(k.shopId, k.startedAt);
        return did ? { cid: k.conversationId, did } : null;
      }),
    );
    for (const r of results) {
      if (r) resolved.set(r.cid, r.did);
    }
  }

  return resolved;
}

export async function runEnrichmentsPipeline(params: {
  conversationKeys: ConversationBundleKey[];
  journeys: Record<string, BundleJourneyJson>;
  eventsByConversationId: Record<string, Record<string, unknown>[]>;
}): Promise<Record<string, ConversationEnrichment>> {
  const { conversationKeys, journeys, eventsByConversationId } = params;

  if (conversationKeys.length === 0) return {};

  const resolvedMap = await resolveDistinctIdsForBundle(
    conversationKeys,
    journeys,
  );

  const enrichments: Record<string, ConversationEnrichment> = {};

  if (resolvedMap.size === 0) {
    for (const k of conversationKeys) {
      const ev = eventsByConversationId[k.conversationId] ?? [];
      enrichments[k.conversationId] = {
        ...emptyEnrichment(),
        ralphRecommendations: extractRecommendations(ev),
      };
    }
    return enrichments;
  }

  const allDids = [...new Set(resolvedMap.values())];
  const eventsByDid = await fetchCheckoutEventsByDistinctIds(allDids);

  for (const k of conversationKeys) {
    const ev = eventsByConversationId[k.conversationId] ?? [];
    const recommendations = extractRecommendations(ev);
    const did = resolvedMap.get(k.conversationId);
    if (!did) {
      enrichments[k.conversationId] = {
        ...emptyEnrichment(),
        ralphRecommendations: recommendations,
      };
      continue;
    }
    const raw = eventsByDid.get(did) ?? [];
    enrichments[k.conversationId] = buildOneEnrichment(
      k,
      did,
      raw,
      recommendations,
    );
  }

  return enrichments;
}

export async function runConversationPosthogBundle(params: {
  dateFrom: string;
  dateTo: string;
  conversationKeys: ConversationBundleKey[];
  eventsByConversationId: Record<string, Record<string, unknown>[]>;
  /** When set (e.g. from GET /api/conversations row cache), skip journey HogQL. */
  prefetchedJourneyRows?: unknown[][] | null;
}): Promise<{
  journeys: Record<string, BundleJourneyJson>;
  enrichments: Record<string, ConversationEnrichment>;
}> {
  const {
    dateFrom,
    dateTo,
    conversationKeys,
    eventsByConversationId,
    prefetchedJourneyRows,
  } = params;

  if (conversationKeys.length === 0) {
    return { journeys: {}, enrichments: {} };
  }

  const cids = conversationKeys.map((k) => k.conversationId);
  const journeys =
    prefetchedJourneyRows != null
      ? buildJourneysFromRawRows(prefetchedJourneyRows, cids)
      : await handleBatchJourneys(cids, dateFrom, dateTo);

  const enrichments = await runEnrichmentsPipeline({
    conversationKeys,
    journeys,
    eventsByConversationId,
  });

  return { journeys, enrichments };
}
