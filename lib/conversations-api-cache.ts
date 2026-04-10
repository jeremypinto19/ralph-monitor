/**
 * Next.js Data Cache (`unstable_cache`) for /api/conversations sources that fit
 * the platform limit (~2MB per cache entry). Full Dynamo scans are larger, so
 * they stay uncached here; use direct `loadAiAgentConversationItems()` instead.
 */

import { unstable_cache } from "next/cache";
import {
  HOGQL_DATA_CONVERSATION_ID,
  HOGQL_DATA_MODE,
  JOURNEY_BATCH_QUERY_ROW_CAP,
  JOURNEY_EVENTS_FILTER,
} from "@/lib/conversation-posthog-bundle";
import { scanTable, resolveShopNames } from "@/lib/dynamo";
import { queryPostHog } from "@/lib/posthog";

/** Shop display names from ShopsProd (GetItem per id). */
const SHOP_NAMES_CACHE_SECONDS = 300;

/** One HogQL batch (up to N conversation ids) for list enrichment. */
const CONV_LIST_POSTHOG_BATCH_CACHE_SECONDS = 90;

const POSTHOG_CONVERSATION_ID_BATCH = 100;

const AI_AGENT_TABLE = "AiAgentConversationsProd";

export interface PhJustAiRow {
  conversationId: string;
  event: string;
  currentUrl: string;
  deviceType: string | null;
  mode: string | null;
  tsUnix: number;
  distinctId: string | null;
}

export async function loadAiAgentConversationItems(): Promise<
  Record<string, unknown>[]
> {
  return scanTable(AI_AGENT_TABLE);
}

const cachedResolveShopNamesInner = unstable_cache(
  async (sortedShopIds: string[]) => {
    if (sortedShopIds.length === 0) return {};
    return resolveShopNames(sortedShopIds);
  },
  ["shops-prod-display-names"],
  {
    revalidate: SHOP_NAMES_CACHE_SECONDS,
    tags: ["dynamo-shops-prod-names"],
  },
);

export async function resolveShopNamesCached(
  shopIds: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(shopIds.filter(Boolean))].sort();
  return cachedResolveShopNamesInner(unique);
}

function hogqlQuote(val: string): string {
  return `'${val.replace(/'/g, "\\'")}'`;
}

/** Same column order as handleBatchJourneys plus list-only fields (indices 5–8). */
function rawUnifiedRowsToJustAiRows(rows: unknown[][]): PhJustAiRow[] {
  const out: PhJustAiRow[] = [];
  for (const row of rows) {
    const ev = (row[1] as string) ?? "";
    if (!ev.startsWith("just_ai_")) continue;
    const cid = row[0] as string;
    if (!cid) continue;
    out.push({
      conversationId: cid,
      event: ev,
      currentUrl: (row[5] as string) || "",
      deviceType: (row[6] as string) || null,
      mode: (row[7] as string) || null,
      tsUnix: Number(row[8]) || 0,
      distinctId: (row[4] as string) || null,
    });
  }
  return out;
}

const cachedUnifiedPosthogBatch = unstable_cache(
  async (
    batch: string[],
    shopFilter: string | null,
    phFrom: string,
    phTo: string,
  ) => {
    const shopClause = shopFilter
      ? `AND JSONExtractString(properties, 'shopId') = ${hogqlQuote(shopFilter)}`
      : "";
    const inList = batch.map(hogqlQuote).join(", ");

    const result = await queryPostHog(`
      SELECT
        ${HOGQL_DATA_CONVERSATION_ID} AS conversation_id,
        event,
        timestamp,
        JSONExtractString(properties, 'data') AS data_json,
        distinct_id,
        properties.\`$current_url\` AS current_url,
        properties.\`$device_type\` AS device_type,
        ${HOGQL_DATA_MODE} AS mode,
        toUnixTimestamp(timestamp) AS ts_unix
      FROM events
      WHERE ${HOGQL_DATA_CONVERSATION_ID} IN (${inList})
        AND ${JOURNEY_EVENTS_FILTER}
        ${shopClause}
        AND timestamp >= '${phFrom}'
        AND timestamp <= '${phTo}'
      ORDER BY conversation_id, timestamp ASC
      LIMIT ${JOURNEY_BATCH_QUERY_ROW_CAP}
    `);

    return result.results as unknown[][];
  },
  ["conv-list-unified-hogql-batch"],
  {
    revalidate: CONV_LIST_POSTHOG_BATCH_CACHE_SECONDS,
    tags: ["posthog-conv-list-unified-batch"],
  },
);

/**
 * Sorted conversation ids so HogQL batch cache keys stay stable across requests.
 */
export async function fetchUnifiedPosthogRowsByConversationIdsCached(
  conversationIds: string[],
  shopFilter: string | null,
  phFrom: string,
  phTo: string,
): Promise<{ justAiRows: PhJustAiRow[]; allRawRows: unknown[][] }> {
  const ids = [...new Set(conversationIds.filter(Boolean))].sort();
  if (ids.length === 0) return { justAiRows: [], allRawRows: [] };

  const allRawRows: unknown[][] = [];

  for (let i = 0; i < ids.length; i += POSTHOG_CONVERSATION_ID_BATCH) {
    const batch = ids.slice(i, i + POSTHOG_CONVERSATION_ID_BATCH);
    const rows = await cachedUnifiedPosthogBatch(
      batch,
      shopFilter,
      phFrom,
      phTo,
    );
    for (const row of rows) {
      allRawRows.push(row);
    }
  }

  return {
    justAiRows: rawUnifiedRowsToJustAiRows(allRawRows),
    allRawRows,
  };
}
