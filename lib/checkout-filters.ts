export type CheckoutPlatformFilter = "all" | "shopify" | "just";

export type CheckoutStageFilter = "all" | "started" | "completed" | "redirect";

/** Same rules as Checkout dashboard: platform × stage (AND). */
export function checkoutEventMatchesFilters(
  eventName: string,
  platform: CheckoutPlatformFilter,
  stage: CheckoutStageFilter,
): boolean {
  const isShopify =
    eventName === "shopify_checkout_started" ||
    eventName === "shopify_checkout_completed";
  const isJustFamily =
    eventName === "just_checkout_started" ||
    eventName === "just_checkout_completed" ||
    eventName === "just_ai_checkout_redirected";

  if (platform === "shopify" && !isShopify) return false;
  if (platform === "just" && !isJustFamily) return false;

  if (stage === "started") {
    return (
      eventName === "shopify_checkout_started" ||
      eventName === "just_checkout_started"
    );
  }
  if (stage === "completed") {
    return (
      eventName === "shopify_checkout_completed" ||
      eventName === "just_checkout_completed"
    );
  }
  if (stage === "redirect") {
    return eventName === "just_ai_checkout_redirected";
  }
  return true;
}
