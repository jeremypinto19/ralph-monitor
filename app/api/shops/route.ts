import { NextResponse } from "next/server";
import { queryPostHog } from "@/lib/posthog";
import { resolveShopNames } from "@/lib/dynamo";
import type { Shop } from "@/lib/types";

export async function GET() {
  try {
    const result = await queryPostHog(`
      SELECT DISTINCT
        JSONExtractString(properties, 'shopId') AS shop_id
      FROM events
      WHERE event LIKE 'just_ai_%'
        AND JSONExtractString(properties, 'shopId') != ''
      LIMIT 500
    `);

    const shopIds = result.results
      .map((r) => r[0] as string)
      .filter(Boolean);

    const names = await resolveShopNames(shopIds);

    const shops: Shop[] = shopIds.map((id) => ({
      id,
      name: names[id] ?? id.slice(0, 8),
    }));

    shops.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ shops });
  } catch (err) {
    console.error("[API /shops]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
