import { NextResponse } from "next/server";
import { queryPostHog } from "@/lib/posthog";

const EVENT_LABELS: Record<string, string> = {
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

/**
 * Find the PostHog distinct_id that matches a DynamoDB conversation by
 * looking for a `just_ai_session_started` event with the same shopId
 * close to the conversation's startedAt timestamp (within ±10s).
 */
async function resolveDistinctId(
  shopId: string,
  startedAt: string,
): Promise<string | null> {
  const ts = new Date(startedAt);
  // PostHog interprets bare datetime strings as Europe/Paris (project tz).
  // DynamoDB startedAt is UTC. We need to shift to Paris time for the query window.
  // Use a tight ±90s window in Paris time around the expected event.
  const offsetMs = 90_000;
  const beforeDate = new Date(ts.getTime() - offsetMs);
  const afterDate = new Date(ts.getTime() + offsetMs);

  // Convert UTC dates to Paris-local strings for PostHog.
  // Europe/Paris is UTC+1 (winter) or UTC+2 (summer).
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

const JOURNEY_EVENTS_FILTER = `(startsWith(event, 'just_ai_')
        OR event = 'just_pay_button_clicked'
        OR event IN (
          'shopify_checkout_started', 'shopify_checkout_completed',
          'just_checkout_started', 'just_checkout_completed'
        ))`;

function hogqlQuote(val: string): string {
  return `'${val.replace(/'/g, "\\'")}'`;
}

function stepsFromPostHogRows(results: unknown[][]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  for (const row of results) {
    const event = row[0] as string;
    const timestamp = row[1] as string;
    const dataJson = row[2] as string;
    steps.push({
      time: timestamp,
      event,
      details: extractDetails(event, dataJson),
    });
  }
  return steps;
}

const JOURNEY_MAX_EVENTS_PER_CONVERSATION = 500;
const JOURNEY_BATCH_MAX_IDS = 120;
const JOURNEY_BATCH_QUERY_ROW_CAP = 50_000;

function parseConversationIdsParam(
  searchParams: URLSearchParams,
): string[] | null {
  if (!searchParams.has("conversationIds")) return null;
  const parts = searchParams.getAll("conversationIds");
  const raw = parts
    .flatMap((p) => p.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

function stepFromBatchRow(row: unknown[]): TimelineStep {
  const event = row[1] as string;
  return {
    time: row[2] as string,
    event,
    details: extractDetails(event, row[3] as string),
  };
}

function buildJourneyJson(
  steps: TimelineStep[],
  resolvedDistinctId?: string,
): {
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
} {
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

async function handleBatchJourneys(
  conversationIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, ReturnType<typeof buildJourneyJson>>> {
  const journeys: Record<string, ReturnType<typeof buildJourneyJson>> = {};
  if (conversationIds.length === 0) return journeys;

  const capped = conversationIds.slice(0, JOURNEY_BATCH_MAX_IDS);
  const dateFromQ = hogqlQuote(dateFrom);
  const dateToQ = hogqlQuote(dateTo);
  const inList = capped.map(hogqlQuote).join(", ");

  const eventsResult = await queryPostHog(`
    SELECT
      JSONExtractString(properties, 'conversationId') AS conversation_id,
      event,
      timestamp,
      JSONExtractString(properties, 'data') AS data_json,
      distinct_id
    FROM events
    WHERE JSONExtractString(properties, 'conversationId') IN (${inList})
      AND ${JOURNEY_EVENTS_FILTER}
      AND timestamp >= ${dateFromQ}
      AND timestamp <= ${dateToQ}
    ORDER BY conversation_id, timestamp ASC
    LIMIT ${JOURNEY_BATCH_QUERY_ROW_CAP}
  `);

  const byCid = new Map<string, TimelineStep[]>();
  const distinctByCid = new Map<string, string>();
  for (const row of eventsResult.results) {
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

async function fetchDistinctIdForConversation(
  conversationId: string,
): Promise<string | null> {
  const result = await queryPostHog(`
    SELECT distinct_id
    FROM events
    WHERE event = 'just_ai_session_started'
      AND JSONExtractString(properties, 'conversationId') = ${hogqlQuote(conversationId)}
    ORDER BY timestamp ASC
    LIMIT 1
  `);
  const did = result.results[0]?.[0] as string | undefined;
  return did ?? null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get("dateFrom") ?? "2024-01-01";
    const dateTo = searchParams.get("dateTo") ?? "2099-12-31";
    const dateFromQ = hogqlQuote(dateFrom);
    const dateToQ = hogqlQuote(dateTo);

    const batchIds = parseConversationIdsParam(searchParams);
    if (batchIds !== null) {
      const journeys = await handleBatchJourneys(batchIds, dateFrom, dateTo);
      return NextResponse.json({ journeys });
    }

    const conversationId = searchParams.get("conversationId") ?? "";
    const distinctIdParam = searchParams.get("distinctId");
    const shopId = searchParams.get("shopId") ?? "";
    const startedAt = searchParams.get("startedAt") ?? "";

    let steps: TimelineStep[] = [];
    let resolvedDistinctId: string | undefined;

    if (conversationId) {
      const byConv = await queryPostHog(`
      SELECT
        event,
        timestamp,
        JSONExtractString(properties, 'data') AS data_json
      FROM events
      WHERE JSONExtractString(properties, 'conversationId') = ${hogqlQuote(conversationId)}
        AND ${JOURNEY_EVENTS_FILTER}
        AND timestamp >= ${dateFromQ}
        AND timestamp <= ${dateToQ}
      ORDER BY timestamp ASC
      LIMIT ${JOURNEY_MAX_EVENTS_PER_CONVERSATION}
    `);
      steps = stepsFromPostHogRows(byConv.results);
      resolvedDistinctId =
        (await fetchDistinctIdForConversation(conversationId)) ?? undefined;
    } else {
      let distinctId = distinctIdParam ?? "";

      if (!distinctId && shopId && startedAt) {
        distinctId = (await resolveDistinctId(shopId, startedAt)) ?? "";
      }

      if (!distinctId) {
        return NextResponse.json({
          summary: "Could not resolve user identity.",
          timeline: [],
          totalEvents: 0,
          resolved: false,
        });
      }

      resolvedDistinctId = distinctId;

      const result = await queryPostHog(`
      SELECT
        event,
        timestamp,
        JSONExtractString(properties, 'data') AS data_json
      FROM events
      WHERE distinct_id = ${hogqlQuote(distinctId)}
        AND ${JOURNEY_EVENTS_FILTER}
        AND timestamp >= ${dateFromQ}
        AND timestamp <= ${dateToQ}
      ORDER BY timestamp ASC
      LIMIT ${JOURNEY_MAX_EVENTS_PER_CONVERSATION}
    `);

      steps = stepsFromPostHogRows(result.results);
    }

    return NextResponse.json(buildJourneyJson(steps, resolvedDistinctId));
  } catch (err) {
    console.error("[API /user-journey]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
