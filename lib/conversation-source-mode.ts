/**
 * Conversation “source” in the dashboard maps to `AiConversation.mode`
 * (PostHog / conversation_started), e.g. Search Mode vs Project Focus Mode.
 */

export type ConversationSourceModeFilter = "all" | "search" | "project_focus";

function normalizeModeKey(mode: string | null | undefined): string {
  if (mode == null || typeof mode !== "string") return "";
  return mode.trim().toLowerCase().replace(/\s+/g, "_");
}

function isProjectFocusNormalized(norm: string): boolean {
  if (!norm) return false;
  if (norm.includes("project_focus")) return true;
  if (norm.includes("projectfocus")) return true;
  if (norm.includes("project") && norm.includes("focus")) return true;
  return false;
}

function isSearchNormalized(norm: string): boolean {
  if (!norm) return false;
  if (isProjectFocusNormalized(norm)) return false;
  return (
    norm === "search" ||
    norm === "searchmode" ||
    norm.includes("search_mode") ||
    norm.startsWith("search_") ||
    norm.endsWith("_search")
  );
}

export function conversationMatchesSourceModeFilter(
  mode: string | null | undefined,
  filter: ConversationSourceModeFilter,
): boolean {
  if (filter === "all") return true;
  const norm = normalizeModeKey(mode);
  if (filter === "project_focus") return isProjectFocusNormalized(norm);
  return isSearchNormalized(norm);
}

export function parseConversationSourceModeFilter(
  raw: string | null,
): ConversationSourceModeFilter {
  if (raw === "search" || raw === "project_focus") return raw;
  return "all";
}
