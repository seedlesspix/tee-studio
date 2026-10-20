// Retention windows shared by the cleanup-cron family. PURE (no env, no imports) so both server routes
// and unit tests can read them.
//
// RETENTION_DAYS: the ephemeral "Custom Design" Shopify product is deleted once it is this old — beyond
// Shopify's ~10-day maximum cart lifetime plus buffer (see /api/cron/retention). A cart can never check
// out a deleted product, so after this point an "In Cart" row can no longer complete.
export const RETENTION_DAYS = 14

// STALE_CART_MIN_AGE_DAYS: an "In Cart" / "Ordering" design_orders row is only ever deleted once it is
// older than the product retention window (plus a day of slack) AND its product is confirmed gone. A
// 7-day window would NOT be safe: a guest cart can still check out on day 9 and the paid webhook would
// then find no row — an unfulfillable order with no design data.
export const STALE_CART_MIN_AGE_DAYS = RETENTION_DAYS + 1
