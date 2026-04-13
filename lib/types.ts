// TypeScript types mirroring Pydantic models from main.py

/**
 * Product bookmark attached to a `user_message` event (`data.bookmark`).
 * Mirrors `ZMessageBookmark` in `@getjust/api-schema/ai-commerce-agent`.
 */
export interface MessageBookmark {
  handle: string;
  title: string;
  imageUrl?: string;
  price: string;
  compareAtPrice?: string;
}

/** User vote on an assistant reply; set via DynamoDB update on the event item. */
export interface AssistantMessageFeedback {
  vote: "up" | "down";
  reasons?: string[];
  freeformText?: string;
  updatedAt: string;
}

export interface AiConversationEvent {
  conversationId: string;
  eventId: string;
  eventType: string;
  createdAt: string;
  shopId: string;
  sessionId?: string | null;
  data: Record<string, unknown>;
  feedback?: AssistantMessageFeedback | null;
}

export type SourcePage = "homepage" | "product" | "collection" | "other" | null;

/** Derived from PostHog (shortcut click vs first typed message ordering). */
export type ConversationLaunchSource = "shortcut" | "input" | "unknown";

export interface AiConversation {
  conversationId: string;
  shopId: string;
  sessionId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  endReason?: string | null;
  events: AiConversationEvent[];
  messageCount: number;
  userMessages: AiConversationEvent[];
  assistantMessages: AiConversationEvent[];
  toolCalls: AiConversationEvent[];
  device?: string | null;
  mode?: string | null;
  sourcePage?: SourcePage;
  /** Set when PostHog rows are loaded for the selected date range; otherwise treat as unknown. */
  launchSource?: ConversationLaunchSource;
  /** First distinct_id on `just_ai_session_started` for this conversation (batch just_ai_ query). */
  posthogDistinctId?: string | null;
}

export interface AiConversationShopGroup {
  shopId: string;
  shopName?: string | null;
  conversations: AiConversation[];
}

export interface PostHogQueryResult {
  columns: string[];
  results: unknown[][];
  types: string[];
}

export interface CheckoutEvent {
  distinctId: string;
  sessionId?: string | null;
  event: string;
  timestamp: string;
  shopId?: string | null;
  shopName?: string | null;
  totalPrice?: number | null;
  orderId?: string | null;
  orderName?: string | null;
  currency?: string | null;
  lineItems?: { title: string; quantity: number }[];
  data?: Record<string, unknown>;
}

export type Attribution =
  | "direct"
  | "reinforcement"
  | "not_influenced"
  | "pdp_shortcut"
  | "unknown";

export interface CheckoutUserGroup {
  distinctId: string;
  customerName?: string | null;
  shopId: string;
  attribution: Attribution;
  attributionDetail: string;
  ralphRecommendations: string[];
  checkoutProducts: string[];
  firstRalphTs?: string | null;
  events: CheckoutEvent[];
}

export interface ConversationCheckoutLink {
  conversation: AiConversation;
  checkoutEvents: CheckoutEvent[];
  timeDeltaSeconds?: number | null;
  direction: "after_ralph" | "before_ralph";
}

export interface Shop {
  id: string;
  name: string;
}

export interface InsightsData {
  totalConversations: number;
  conversationsWithMessages: number;
  totalMessages: number;
  avgMessagesPerConversation: number;
  deviceBreakdown: Record<string, number>;
  modeBreakdown: Record<string, number>;
  conversationsWithCheckout: number;
  checkoutRate: number;
  checkoutCompletedClassic: number;
  checkoutCompletedJust: number;
  activeShops: number;
  volumeOverTime: { date: string; count: number }[];
  avgMessagesOverTime: { date: string; count: number }[];
  messageDistribution: { name: string; value: number }[];
  topShops: { shopId: string; shopName: string; count: number }[];
  conversationsByShop: Record<string, number>;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ConversationEnrichment {
  hasCheckout: boolean;
  checkoutType: "just" | "shopify" | "both" | null;
  checkoutCompleted: boolean;
  checkoutEvents: CheckoutEvent[];
  attribution: Attribution | null;
  attributionDetail: string | null;
  ralphRecommendations: string[];
  checkoutProducts: string[];
}

export interface ConversationsFilters {
  shopIds?: string[];
  dateRange?: DateRange;
  device?: string;
  mode?: string;
}

export interface AnalyticsDimension {
  name: string;
  count: number;
  examples: string[];
  byDevice: Record<string, number>;
  byMode: Record<string, number>;
}

export interface AnalyticsData {
  totalQuestions: number;
  dimensions: AnalyticsDimension[];
  dailyTrends: Record<string, unknown>[];
  perShop: Record<string, Record<string, number>>;
  deviceBreakdown: Record<string, number>;
}
