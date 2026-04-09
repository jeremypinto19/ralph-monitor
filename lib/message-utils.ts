export interface Recommendation {
  handle: string;
  title: string;
  imageUrl?: string;
  price?: string;
  reason?: string;
}

export interface ParsedMessage {
  text: string;
  recommendations: Recommendation[];
}

function extractFencedJson(s: string): { before: string; json: Record<string, unknown> } | null {
  const fenceStart = s.indexOf("```");
  if (fenceStart === -1) return null;

  let inner = s.slice(fenceStart);
  inner = inner.replace(/^```\w*\n?/, "");
  const lastFence = inner.lastIndexOf("```");
  if (lastFence !== -1) {
    inner = inner.slice(0, lastFence);
  }
  inner = inner.trim();

  try {
    const parsed = JSON.parse(inner);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { before: s.slice(0, fenceStart).trim(), json: parsed };
    }
  } catch { /* not valid JSON */ }
  return null;
}

function tryParseJson(val: unknown): Record<string, unknown> | null {
  if (typeof val !== "string") return null;
  const fenced = extractFencedJson(val);
  if (fenced) return fenced.json;
  try {
    const parsed = JSON.parse(val.trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed;
  } catch { /* not valid JSON */ }
  return null;
}

function tryExtractWithPreamble(val: unknown): ParsedMessage | null {
  if (typeof val !== "string") return null;
  const fenced = extractFencedJson(val);
  if (!fenced) return null;

  const inner = extractFromObject(fenced.json);
  const text = fenced.before || inner?.text || "";
  const recs = inner?.recommendations ?? [];
  if (text || recs.length > 0) return { text, recommendations: recs };
  return null;
}

function extractFromObject(obj: Record<string, unknown>): ParsedMessage | null {
  const msg = obj.message ?? obj.content ?? obj.text ?? obj.query ?? obj.response;
  if (typeof msg === "string" && msg.trim()) {
    const withPreamble = tryExtractWithPreamble(msg);
    if (withPreamble) return withPreamble;

    const nested = tryParseJson(msg);
    if (nested) return extractFromObject(nested);

    const recs = parseRecommendations(obj.recommendations);
    return { text: msg.trim(), recommendations: recs };
  }

  if (obj.recommendations && typeof obj.message !== "string") {
    return {
      text: "",
      recommendations: parseRecommendations(obj.recommendations),
    };
  }

  return null;
}

function parseRecommendations(raw: unknown): Recommendation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => r && typeof r === "object")
    .map((r) => ({
      handle: String(r.handle ?? ""),
      title: String(r.title ?? ""),
      imageUrl: r.imageUrl ? String(r.imageUrl) : undefined,
      price: r.price ? String(r.price) : undefined,
      reason: r.reason ? String(r.reason) : undefined,
    }))
    .filter((r) => r.title || r.handle);
}

export function parseMessage(data: Record<string, unknown>): ParsedMessage {
  for (const val of Object.values(data)) {
    const withPreamble = tryExtractWithPreamble(val);
    if (withPreamble) return withPreamble;

    const nested = tryParseJson(val);
    if (nested) {
      const result = extractFromObject(nested);
      if (result && (result.text || result.recommendations.length > 0))
        return result;
    }
  }

  const direct = extractFromObject(data);
  if (direct && (direct.text || direct.recommendations.length > 0))
    return direct;

  return { text: "", recommendations: [] };
}

export function extractPlainText(data: Record<string, unknown>): string {
  const { text } = parseMessage(data);
  return text;
}
