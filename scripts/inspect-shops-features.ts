/**
 * Debug: count shops with shopify.app.ai_agent_enabled (no secrets logged).
 * Run: bun run scripts/inspect-shops-features.ts
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient, resetDynamoClient } from "../lib/dynamo";

function safeShopLine(item: Record<string, unknown>): string {
  const shopify = item.shopify as Record<string, unknown> | undefined;
  const app = shopify?.app as Record<string, unknown> | undefined;
  return JSON.stringify({
    id: item.id,
    name: item.name,
    company_name: item.company_name,
    ai_agent_enabled: app?.ai_agent_enabled,
    app_shop_name: app?.shop_name,
    shopify_shop_name: shopify?.shop_name,
  });
}

async function main() {
  resetDynamoClient();
  const client = await getDynamoClient();

  let lastKey: Record<string, unknown> | undefined;
  let withAgent = 0;

  do {
    const res = await client.send(
      new ScanCommand({
        TableName: "ShopsProd",
        FilterExpression: "shopify.app.ai_agent_enabled = :t",
        ExpressionAttributeValues: { ":t": true },
        ProjectionExpression: "id, #n, company_name, shopify.#app",
        ExpressionAttributeNames: { "#n": "name", "#app": "app" },
        ExclusiveStartKey: lastKey,
      }),
    );
    const items = (res.Items ?? []) as Record<string, unknown>[];
    withAgent += items.length;
    for (const item of items.slice(0, 15)) {
      console.log(safeShopLine(item));
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  console.log("matched (ai agent enabled):", withAgent);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
