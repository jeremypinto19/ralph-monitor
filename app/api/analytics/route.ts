import { NextResponse } from "next/server";
import { scanTable } from "@/lib/dynamo";
import { queryPostHog } from "@/lib/posthog";
import type { AnalyticsData, AnalyticsDimension } from "@/lib/types";

/** PostHog interprets bare datetime strings as Europe/Paris (project tz). */
function utcToParis(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).replace("T", " ");
}

interface QuestionRecord {
  text: string;
  device: string;
  mode: string;
  shopId: string;
  date: string;
}

const CATEGORIES: { name: string; patterns: RegExp[] }[] = [
  {
    name: "Shipping & Delivery",
    patterns: [
      /livraison/i, /expédition/i, /expedition/i, /shipping/i, /delivery/i,
      /délai/i, /delai/i, /envo[iy]/i, /colis/i, /suivi/i, /tracking/i,
      /livré/i, /livre/i, /recevoir/i, /quand.*arriv/i, /combien.*temps/i,
      /frais.*port/i, /mondial\s*relay/i, /colissimo/i, /chronopost/i,
      /point\s*relais/i, /retrait/i, /click.*collect/i,
    ],
  },
  {
    name: "Sizing & Fit",
    patterns: [
      /taille/i, /size/i, /sizing/i, /mesure/i, /fit/i, /pointure/i,
      /grand/i, /petit/i, /large/i, /small/i, /medium/i, /guide.*taille/i,
      /trop\s*(grand|petit)/i, /correspond/i, /mensuration/i, /cm/i,
    ],
  },
  {
    name: "Product Variants & Colors",
    patterns: [
      /couleur/i, /color/i, /colour/i, /variante/i, /variant/i,
      /noir/i, /blanc/i, /rouge/i, /bleu/i, /rose/i, /vert/i,
      /disponible.*en/i, /existe.*en/i, /other.*color/i, /autre.*couleur/i,
      /motif/i, /pattern/i, /matière/i, /tissu/i, /fabric/i,
    ],
  },
  {
    name: "Price & Promotions",
    patterns: [
      /prix/i, /price/i, /promo/i, /réduction/i, /reduction/i, /solde/i,
      /discount/i, /code/i, /coupon/i, /offre/i, /offer/i, /gratuit/i,
      /free/i, /cher/i, /expensive/i, /budget/i, /moins.*cher/i,
      /combien/i, /how\s*much/i, /cost/i, /€/i, /euro/i,
    ],
  },
  {
    name: "Stock & Availability",
    patterns: [
      /stock/i, /disponib/i, /availab/i, /rupture/i, /out.*stock/i,
      /reste/i, /en\s*stock/i, /quand.*retour/i, /restock/i,
      /back\s*in/i, /épuisé/i, /epuise/i, /sold\s*out/i,
    ],
  },
  {
    name: "Returns & Exchanges",
    patterns: [
      /retour/i, /return/i, /échange/i, /exchange/i, /rembours/i,
      /refund/i, /renvoy/i, /renvoyer/i, /satisfait/i, /garantie/i,
      /warranty/i, /politique.*retour/i, /return.*policy/i,
    ],
  },
  {
    name: "Product Recommendations",
    patterns: [
      /recommand/i, /recommend/i, /suggest/i, /conseil/i,
      /cherche/i, /looking\s*for/i, /besoin/i, /need/i,
      /idée/i, /idea/i, /cadeau/i, /gift/i, /pour\s*(un|une|mon|ma)/i,
      /quoi.*offrir/i, /quel.*(produit|article)/i, /meilleur/i, /best/i,
      /populaire/i, /popular/i, /tendance/i, /nouveau/i,
    ],
  },
  {
    name: "Order & Payment",
    patterns: [
      /commande/i, /order/i, /paiement/i, /payment/i, /pay/i,
      /carte/i, /card/i, /paypal/i, /virement/i, /facture/i,
      /invoice/i, /confirmation/i, /annul/i, /cancel/i,
      /modifi/i, /modify/i, /changer.*commande/i, /apple\s*pay/i,
    ],
  },
  {
    name: "Product Care & Details",
    patterns: [
      /entretien/i, /care/i, /lav/i, /wash/i, /nettoy/i, /clean/i,
      /composition/i, /matériau/i, /material/i, /dimension/i,
      /poids/i, /weight/i, /détail/i, /detail/i, /description/i,
      /comment.*utilis/i, /how.*use/i, /instruction/i,
    ],
  },
  {
    name: "Account & Loyalty",
    patterns: [
      /compte/i, /account/i, /connecter/i, /login/i, /mot.*passe/i,
      /password/i, /fidélit/i, /loyalty/i, /points/i, /membre/i,
      /member/i, /inscri/i, /register/i, /newsletter/i, /parrainage/i,
    ],
  },
];

function categorize(text: string): string {
  const normalized = text.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.patterns.some((p) => p.test(normalized))) {
      return cat.name;
    }
  }
  return "Other";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") ?? "2024-01-01";
    const dateTo = searchParams.get("dateTo") ?? "2099-12-31";
    const shopFilter = searchParams.get("shopId") ?? null;
    const dateToEnd = dateTo.length === 10 ? `${dateTo}T23:59:59.999Z` : dateTo;

    const items = await scanTable("AiAgentConversationsProd");

    // Extract context per conversation (device, mode, shopId from conversation_started)
    const convoMeta = new Map<
      string,
      { device: string; mode: string; shopId: string; startedAt: string }
    >();
    for (const item of items) {
      const cid = item.conversationId as string;
      const eventType = item.eventType as string;
      const createdAt = (item.createdAt as string) ?? "";
      if (eventType === "conversation_started") {
        const data = (item.data ?? {}) as Record<string, unknown>;
        convoMeta.set(cid, {
          device: (data.device as string) ?? "unknown",
          mode: (data.mode as string) ?? "unknown",
          shopId: (item.shopId as string) ?? "",
          startedAt: createdAt,
        });
      } else if (!convoMeta.has(cid)) {
        convoMeta.set(cid, {
          device: "unknown",
          mode: "unknown",
          shopId: (item.shopId as string) ?? "",
          startedAt: createdAt,
        });
      }
    }

    // Enrich device + mode from PostHog when DynamoDB has "unknown"
    try {
      const phFrom = utcToParis(new Date(dateFrom));
      const phTo = utcToParis(new Date(dateTo.length === 10 ? `${dateTo}T23:59:59Z` : dateTo));
      const shopClause = shopFilter
        ? `AND JSONExtractString(properties, 'shopId') = '${shopFilter.replace(/'/g, "\\'")}'`
        : "";
      const phResult = await queryPostHog(`
        SELECT
          JSONExtractString(properties, 'shopId') AS shop_id,
          toString(toUnixTimestamp(timestamp)) AS unix_ts,
          properties.\`$device_type\` AS device_type,
          properties.\`$current_url\` AS current_url,
          JSONExtractString(properties, 'mode') AS mode
        FROM events
        WHERE event = 'just_ai_session_started'
          ${shopClause}
          AND timestamp >= '${phFrom}'
          AND timestamp <= '${phTo}'
        ORDER BY timestamp ASC
        LIMIT 50000
      `);

      const phEntries: { shopId: string; unixTs: number; deviceType: string; url: string; mode: string }[] = [];
      for (const row of phResult.results) {
        const sid = row[0] as string;
        const unixTs = parseInt(row[1] as string, 10);
        const dt = (row[2] as string) || "";
        const url = (row[3] as string) || "";
        const mode = (row[4] as string) || "";
        if (sid) phEntries.push({ shopId: sid, unixTs, deviceType: dt.toLowerCase(), url, mode: mode.toLowerCase() });
      }

      // Also fetch widget/message events for mode fallback
      const widgetResult = await queryPostHog(`
        SELECT
          JSONExtractString(properties, 'shopId') AS shop_id,
          toString(toUnixTimestamp(timestamp)) AS unix_ts,
          properties.\`$current_url\` AS current_url,
          JSONExtractString(properties, 'mode') AS mode
        FROM events
        WHERE event IN ('just_ai_widget_opened', 'just_ai_trigger_bar_expanded', 'just_ai_message_sent')
          ${shopClause}
          AND timestamp >= '${phFrom}'
          AND timestamp <= '${phTo}'
        ORDER BY timestamp ASC
        LIMIT 50000
      `);

      const widgetEntries: { shopId: string; unixTs: number; url: string; mode: string }[] = [];
      for (const row of widgetResult.results) {
        const sid = row[0] as string;
        const unixTs = parseInt(row[1] as string, 10);
        const url = (row[2] as string) || "";
        const mode = (row[3] as string) || "";
        if (sid) widgetEntries.push({ shopId: sid, unixTs, url, mode: mode.toLowerCase() });
      }

      for (const [, meta] of convoMeta) {
        if (!meta.startedAt) continue;
        const convUnix = Math.floor(new Date(meta.startedAt).getTime() / 1000);

        // Match session_started events (±300s)
        let best: { deviceType: string; url: string; mode: string; diff: number } | null = null;
        for (const entry of phEntries) {
          if (entry.shopId !== meta.shopId) continue;
          const diff = Math.abs(entry.unixTs - convUnix);
          if (diff <= 300 && (!best || diff < best.diff)) {
            best = { deviceType: entry.deviceType, url: entry.url, mode: entry.mode, diff };
          }
        }

        if (best) {
          if (meta.device === "unknown" && best.deviceType) meta.device = best.deviceType;
          if (meta.mode === "unknown" && best.mode) meta.mode = best.mode;
          if (meta.mode === "unknown" && best.url) {
            meta.mode = /\/products\//i.test(best.url) ? "product" : "search";
          }
        }

        // Widget/message fallback for mode
        if (meta.mode === "unknown") {
          let bestWidget: { url: string; mode: string; diff: number } | null = null;
          for (const entry of widgetEntries) {
            if (entry.shopId !== meta.shopId) continue;
            const diff = entry.unixTs - convUnix;
            if (diff >= -30 && diff <= 600 && (!bestWidget || diff < bestWidget.diff)) {
              bestWidget = { url: entry.url, mode: entry.mode, diff };
            }
          }
          if (bestWidget?.mode) {
            meta.mode = bestWidget.mode;
          } else if (bestWidget?.url) {
            meta.mode = /\/products\//i.test(bestWidget.url) ? "product" : "search";
          }
        }
      }
    } catch (err) {
      console.error("[analytics] PostHog enrichment failed:", err);
    }

    const questions: QuestionRecord[] = [];

    for (const item of items) {
      const eventType = item.eventType as string;
      if (eventType !== "user_message") continue;

      const createdAt = (item.createdAt as string) ?? "";
      if (createdAt < dateFrom || createdAt > dateToEnd) continue;

      const shopId = (item.shopId as string) ?? "";
      if (shopFilter && shopId !== shopFilter) continue;

      const data = (item.data ?? {}) as Record<string, unknown>;
      const text =
        (data.message as string) ??
        (data.content as string) ??
        (data.text as string) ??
        "";
      if (!text.trim()) continue;

      const cid = (item.conversationId as string) ?? "";
      const meta = convoMeta.get(cid);

      questions.push({
        text: text.trim(),
        device: meta?.device ?? "unknown",
        mode: meta?.mode ?? "unknown",
        shopId: meta?.shopId ?? shopId,
        date: createdAt.slice(0, 10),
      });
    }

    // Categorize all questions
    const dimMap = new Map<
      string,
      {
        count: number;
        examples: string[];
        byDevice: Record<string, number>;
        byMode: Record<string, number>;
      }
    >();

    const dailyMap = new Map<string, Record<string, number>>();
    const perShop = new Map<string, Record<string, number>>();

    for (const q of questions) {
      const category = categorize(q.text);

      if (!dimMap.has(category)) {
        dimMap.set(category, { count: 0, examples: [], byDevice: {}, byMode: {} });
      }
      const dim = dimMap.get(category)!;
      dim.count++;
      if (dim.examples.length < 5) dim.examples.push(q.text);
      dim.byDevice[q.device] = (dim.byDevice[q.device] ?? 0) + 1;
      dim.byMode[q.mode] = (dim.byMode[q.mode] ?? 0) + 1;

      if (!dailyMap.has(q.date)) dailyMap.set(q.date, {});
      const day = dailyMap.get(q.date)!;
      day[category] = (day[category] ?? 0) + 1;

      if (q.shopId) {
        if (!perShop.has(q.shopId)) perShop.set(q.shopId, {});
        const shop = perShop.get(q.shopId)!;
        shop[category] = (shop[category] ?? 0) + 1;
      }
    }

    const dimensions: AnalyticsDimension[] = [...dimMap.entries()]
      .map(([name, d]) => ({
        name,
        count: d.count,
        examples: d.examples,
        byDevice: d.byDevice,
        byMode: d.byMode,
      }))
      .sort((a, b) => b.count - a.count);

    const dailyTrends = [...dailyMap.entries()]
      .map(([date, cats]) => ({ date, ...cats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const perShopObj: Record<string, Record<string, number>> = {};
    for (const [sid, cats] of perShop) {
      perShopObj[sid] = cats;
    }

    const deviceBreakdown: Record<string, number> = {};
    for (const q of questions) {
      deviceBreakdown[q.device] = (deviceBreakdown[q.device] ?? 0) + 1;
    }

    const data: AnalyticsData = {
      totalQuestions: questions.length,
      dimensions,
      dailyTrends,
      perShop: perShopObj,
      deviceBreakdown,
    };

    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[API /analytics]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
