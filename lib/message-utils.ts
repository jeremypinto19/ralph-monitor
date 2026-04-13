import type { MessageBookmark } from "@/lib/types";

export interface Recommendation {
  handle: string;
  title: string;
  imageUrl?: string;
  price?: string;
  compareAtPrice?: string;
  reason?: string;
}

/** Link surfaced in the assistant JSON payload (`links`). */
export interface ParsedLink {
  url: string;
  label?: string;
}

/** Multiple-choice prompt from the assistant payload (`questions`). */
export interface ParsedQuestion {
  prompt: string;
  options: string[];
}

export interface ParsedMessage {
  text: string;
  recommendations: Recommendation[];
  links: ParsedLink[];
  questions: ParsedQuestion[];
  /** Widget action when non-empty (e.g. CTA type); null if absent or `{}`. */
  action: Record<string, unknown> | null;
  lang?: string;
}

function emptyParsed(): ParsedMessage {
  return {
    text: "",
    recommendations: [],
    links: [],
    questions: [],
    action: null,
    lang: undefined,
  };
}

/** Collapse whitespace so we can detect duplicate prose before/inside JSON. */
function normalizeForDedup(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

/**
 * Assistant payloads often repeat the same reply as prose before a fenced JSON
 * block and again in `message` / `content`. Concatenating both duplicates the UI;
 * when normalized text matches, keep the preamble (usually preserves line breaks).
 */
function mergePreambleWithInner(preamble: string, innerText: string): string {
  const pre = preamble.trim();
  const inner = innerText.trim();
  if (!pre) return inner;
  if (!inner) return pre;
  if (normalizeForDedup(pre) === normalizeForDedup(inner)) return pre;
  return `${pre}\n\n${inner}`.trim();
}

function extractFencedJson(
  s: string,
): { before: string; json: Record<string, unknown> } | null {
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
  } catch {
    /* not valid JSON */
  }
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
  } catch {
    /* not valid JSON */
  }
  return null;
}

function normalizeAction(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return Object.keys(o).length === 0 ? null : o;
}

function parseLinks(raw: unknown): ParsedLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedLink[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ url: item.trim() });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const url = String(o.url ?? o.href ?? o.link ?? "");
      if (!url) continue;
      const label = o.label ?? o.title;
      out.push({
        url,
        label:
          typeof label === "string" && label.trim() ? label.trim() : undefined,
      });
    }
  }
  return out;
}

function optionLabel(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return String(o.label ?? o.text ?? o.title ?? o.value ?? "");
  }
  return String(x ?? "");
}

function parseQuestions(raw: unknown): ParsedQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const prompt = String(
      o.text ?? o.question ?? o.prompt ?? o.label ?? o.title ?? "",
    ).trim();
    const optRaw = o.options ?? o.choices ?? o.answers ?? o.buttons;
    let options: string[] = [];
    if (Array.isArray(optRaw)) {
      options = optRaw.map(optionLabel).filter(Boolean);
    }
    if (prompt || options.length > 0) out.push({ prompt, options });
  }
  return out;
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
      compareAtPrice: r.compareAtPrice ? String(r.compareAtPrice) : undefined,
      reason: r.reason ? String(r.reason) : undefined,
    }))
    .filter((r) => r.title || r.handle);
}

function extrasFromObject(
  obj: Record<string, unknown>,
): Omit<ParsedMessage, "text"> {
  return {
    recommendations: parseRecommendations(obj.recommendations),
    links: parseLinks(obj.links),
    questions: parseQuestions(obj.questions),
    action: normalizeAction(obj.action),
    lang: typeof obj.lang === "string" ? obj.lang : undefined,
  };
}

function parsedFromAssistantJson(
  obj: Record<string, unknown>,
): ParsedMessage | null {
  const msg =
    obj.message ?? obj.content ?? obj.text ?? obj.query ?? obj.response;
  const x = extrasFromObject(obj);

  if (typeof msg === "string" && msg.trim()) {
    const trimmed = msg.trim();
    const fencedInner = extractFencedJson(trimmed);
    if (fencedInner) {
      const inner = parsedFromAssistantJson(fencedInner.json);
      if (inner) {
        const pre = fencedInner.before.trim();
        return {
          ...inner,
          text: mergePreambleWithInner(pre, inner.text),
        };
      }
    }
    const nested = tryParseJson(trimmed);
    if (nested) {
      const inner = parsedFromAssistantJson(nested);
      if (inner) return inner;
    }
    return { ...emptyParsed(), ...x, text: trimmed };
  }

  if (
    x.recommendations.length > 0 ||
    x.links.length > 0 ||
    x.questions.length > 0 ||
    x.action ||
    x.lang
  ) {
    return { ...emptyParsed(), ...x };
  }

  return null;
}

function tryExtractWithPreamble(val: unknown): ParsedMessage | null {
  if (typeof val !== "string") return null;
  const fenced = extractFencedJson(val);
  if (!fenced) return null;
  const payload = parsedFromAssistantJson(fenced.json);
  if (!payload) return null;
  const preamble = fenced.before.trim();
  if (preamble) {
    return { ...payload, text: mergePreambleWithInner(preamble, payload.text) };
  }
  return payload;
}

function parsedHasContent(p: ParsedMessage): boolean {
  return (
    !!p.text ||
    p.recommendations.length > 0 ||
    p.links.length > 0 ||
    p.questions.length > 0 ||
    !!p.action ||
    !!p.lang
  );
}

export function parseMessage(data: Record<string, unknown>): ParsedMessage {
  const empty = emptyParsed();
  for (const val of Object.values(data)) {
    const withPreamble = tryExtractWithPreamble(val);
    if (withPreamble && parsedHasContent(withPreamble)) return withPreamble;

    const nested = tryParseJson(val);
    if (nested) {
      const result = parsedFromAssistantJson(nested);
      if (result && parsedHasContent(result)) return result;
    }
  }

  const direct = parsedFromAssistantJson(data);
  if (direct && parsedHasContent(direct)) return direct;

  return empty;
}

export function extractPlainText(data: Record<string, unknown>): string {
  const { text } = parseMessage(data);
  return text;
}

/**
 * Parses `data.bookmark` on user messages. Invalid or partial payloads return null.
 */
export function parseMessageBookmark(
  data: Record<string, unknown>,
): MessageBookmark | null {
  const raw = data.bookmark;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const handle = typeof o.handle === "string" ? o.handle.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const price = typeof o.price === "string" ? o.price.trim() : "";
  if (!handle || !title) return null;

  let imageUrl: string | undefined;
  if (typeof o.imageUrl === "string" && o.imageUrl.trim()) {
    const candidate = o.imageUrl.trim();
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        imageUrl = candidate;
      }
    } catch {
      /* ignore invalid */
    }
  }

  const compareAtPrice =
    typeof o.compareAtPrice === "string" && o.compareAtPrice.trim()
      ? o.compareAtPrice.trim()
      : undefined;

  return { handle, title, imageUrl, price, compareAtPrice };
}
