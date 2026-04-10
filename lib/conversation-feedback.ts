import type {
  AiConversationEvent,
  AssistantMessageFeedback,
} from "@/lib/types";

const KNOWN_REASON_LABELS: Record<string, string> = {
  irrelevant_products: "Irrelevant products",
  wrong_information: "Wrong information",
};

/** Human-readable label for a backend reason code (snake_case). */
export function formatFeedbackReason(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return code;
  const known = KNOWN_REASON_LABELS[trimmed];
  if (known) return known;
  return trimmed
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export interface ConversationFeedbackSummary {
  hasUp: boolean;
  hasDown: boolean;
  /** Unique reason codes in first-seen order across assistant messages with feedback. */
  reasonCodes: string[];
}

export function summarizeConversationFeedback(
  events: AiConversationEvent[],
): ConversationFeedbackSummary {
  let hasUp = false;
  let hasDown = false;
  const seen = new Set<string>();
  const reasonCodes: string[] = [];

  for (const e of events) {
    if (e.eventType !== "assistant_message" || !e.feedback) continue;
    const { vote, reasons } = e.feedback;
    if (vote === "up") hasUp = true;
    if (vote === "down") hasDown = true;
    if (reasons?.length) {
      for (const r of reasons) {
        if (typeof r !== "string" || !r.trim()) continue;
        if (seen.has(r)) continue;
        seen.add(r);
        reasonCodes.push(r);
      }
    }
  }

  return { hasUp, hasDown, reasonCodes };
}

/**
 * Narrow sanitized JSON from Dynamo into AssistantMessageFeedback, or undefined if invalid.
 */
export function parseSanitizedAssistantFeedback(
  raw: unknown,
): AssistantMessageFeedback | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const vote = o.vote;
  if (vote !== "up" && vote !== "down") return undefined;
  const updatedAt =
    typeof o.updatedAt === "string" && o.updatedAt.trim()
      ? o.updatedAt
      : undefined;
  if (!updatedAt) return undefined;

  const reasons = Array.isArray(o.reasons)
    ? o.reasons.filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0,
      )
    : undefined;

  const freeformText =
    typeof o.freeformText === "string" && o.freeformText.trim()
      ? o.freeformText
      : undefined;

  const out: AssistantMessageFeedback = {
    vote,
    updatedAt,
  };
  if (reasons?.length) out.reasons = reasons;
  if (freeformText) out.freeformText = freeformText;
  return out;
}
