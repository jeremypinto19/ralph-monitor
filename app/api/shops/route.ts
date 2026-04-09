import { NextResponse } from "next/server";
import { listShopsWithAiAgentEnabled } from "@/lib/dynamo";
import type { Shop } from "@/lib/types";

export async function GET() {
  try {
    const shops: Shop[] = await listShopsWithAiAgentEnabled();
    return NextResponse.json({ shops });
  } catch (err) {
    console.error("[API /shops]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
