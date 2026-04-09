import type { PostHogQueryResult } from "./types";

const PROJECT_ID = 7531;
const BASE_URL = "https://us.posthog.com/api/projects";

function getApiKey(): string {
  const key = process.env.POSTHOG_API_KEY;
  if (!key) throw new Error("POSTHOG_API_KEY is not set");
  return key;
}

export async function queryPostHog(hogql: string): Promise<PostHogQueryResult> {
  const res = await fetch(`${BASE_URL}/${PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog query failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  return {
    columns: json.columns ?? [],
    results: json.results ?? [],
    types: json.types ?? [],
  };
}
