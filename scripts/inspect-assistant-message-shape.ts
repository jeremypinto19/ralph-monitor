/**
 * Scan DynamoDB assistant_message rows to discover `data` shape (questions, actions, etc.).
 * Requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (same as ralph-monitor API).
 *
 * Run: bun run scripts/inspect-assistant-message-shape.ts  (loads .env automatically)
 *      npx tsx scripts/inspect-assistant-message-shape.ts
 * Optional:
 *   MAX_PAGES=5 (default 8) — each page is up to 1MB scanned.
 *   FULL_LOG=1 — log every assistant_message `data` in the scan (complete JSON, can be huge).
 *   SAMPLE_LIMIT=12 — when FULL_LOG unset, max “interesting” rows logged in full (default 12).
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient, resetDynamoClient } from "../lib/dynamo";

const MAX_PAGES = Math.max(1, Number(process.env.MAX_PAGES ?? "8"));
const FULL_LOG =
  process.env.FULL_LOG === "1" || process.env.FULL_LOG === "true";
const SAMPLE_LIMIT = Math.max(1, Number(process.env.SAMPLE_LIMIT ?? "12"));

function collectKeys(
  val: unknown,
  prefix: string,
  into: Set<string>,
  depth: number,
): void {
  if (depth > 8 || val == null) return;
  if (typeof val === "string") {
    const t = val.trim();
    if (
      (t.startsWith("{") && t.endsWith("}")) ||
      (t.startsWith("[") && t.endsWith("]"))
    ) {
      try {
        collectKeys(JSON.parse(t), prefix, into, depth + 1);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  if (Array.isArray(val)) {
    into.add(`${prefix}[]`);
    for (const el of val.slice(0, 3)) {
      collectKeys(el, `${prefix}[].`, into, depth + 1);
    }
    return;
  }
  if (typeof val === "object") {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      into.add(p);
      collectKeys(v, p, into, depth + 1);
    }
  }
}

async function main() {
  resetDynamoClient();
  const client = await getDynamoClient();

  const keyCounts = new Map<string, number>();
  let assistantRows = 0;
  let pages = 0;
  let lastKey: Record<string, unknown> | undefined;

  const samples: {
    conversationId: string;
    createdAt: string;
    fullData: Record<string, unknown>;
  }[] = [];

  do {
    const res = await client.send(
      new ScanCommand({
        TableName: "AiAgentConversationsProd",
        FilterExpression: "#et = :am",
        ExpressionAttributeNames: { "#et": "eventType", "#d": "data" },
        ExpressionAttributeValues: { ":am": "assistant_message" },
        ProjectionExpression: "conversationId, createdAt, #d",
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    );

    const items = (res.Items ?? []) as Record<string, unknown>[];
    assistantRows += items.length;

    for (const item of items) {
      const data = item.data as Record<string, unknown> | undefined;
      if (!data) continue;
      const keys = new Set<string>();
      collectKeys(data, "", keys, 0);
      for (const k of keys) {
        keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      }

      const raw = JSON.stringify(data);
      const interesting =
        raw.toLowerCase().includes("question") ||
        raw.toLowerCase().includes("action") ||
        raw.toLowerCase().includes("option") ||
        raw.toLowerCase().includes("buy");

      if (FULL_LOG) {
        console.log(
          JSON.stringify(
            {
              conversationId: item.conversationId,
              createdAt: item.createdAt,
              data,
            },
            null,
            2,
          ),
        );
      } else if (interesting && samples.length < SAMPLE_LIMIT) {
        samples.push({
          conversationId: String(item.conversationId ?? ""),
          createdAt: String(item.createdAt ?? ""),
          fullData: data,
        });
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    pages += 1;
    if (pages >= MAX_PAGES) break;
  } while (lastKey);

  const sortedKeys = [...keyCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log("--- assistant_message scan (partial if MAX_PAGES reached) ---");
  console.log("pages scanned:", pages);
  console.log("assistant_message rows matched (this batch):", assistantRows);
  console.log("\nTop nested key paths (frequency among matched rows):");
  for (const [k, c] of sortedKeys.slice(0, 80)) {
    console.log(`  ${c}\t${k || "(root)"}`);
  }

  if (!FULL_LOG) {
    console.log(
      "\nComplete `data` for sample rows (keyword question|action|option|buy). Set FULL_LOG=1 to log every assistant_message in the scan.",
    );
    for (const s of samples) {
      console.log("\n---", s.conversationId, s.createdAt);
      console.log(JSON.stringify(s.fullData, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
