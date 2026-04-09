/**
 * In-memory cache for unified PostHog event rows between GET /api/conversations
 * and POST /api/conversations/posthog-bundle. Best-effort on serverless (miss = fallback HogQL).
 */

const TTL_MS = 3 * 60 * 1000;
const MAX_ENTRIES = 40;
/** Rough cap on stored rows to limit memory per instance. */
const MAX_TOTAL_ROWS = 120_000;

interface CacheEntry {
  rows: unknown[][];
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, e] of store) {
    if (now > e.expiresAt) store.delete(id);
  }
}

function enforceCaps(incomingRowCount: number): void {
  pruneExpired();
  while (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value as string | undefined;
    if (first === undefined) break;
    store.delete(first);
  }
  let existingSum = 0;
  for (const e of store.values()) existingSum += e.rows.length;
  while (existingSum + incomingRowCount > MAX_TOTAL_ROWS && store.size > 0) {
    const first = store.keys().next().value as string;
    const removed = store.get(first);
    store.delete(first);
    existingSum -= removed?.rows.length ?? 0;
  }
}

/**
 * Store rows and return an opaque token for the next posthog-bundle request.
 */
export function setPosthogRowCache(rows: unknown[][]): string {
  enforceCaps(rows.length);
  const id = crypto.randomUUID();
  store.set(id, { rows, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getPosthogRowCache(id: string): unknown[][] | null {
  pruneExpired();
  const e = store.get(id);
  if (!e || Date.now() > e.expiresAt) {
    store.delete(id);
    return null;
  }
  return e.rows;
}
