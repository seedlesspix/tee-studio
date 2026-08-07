// Volume-pricing tiers (BETA item 14).
//
// ⚠ The ACTUAL discount is enforced by a Shopify quantity-tier discount app AT CHECKOUT. This config
// ONLY drives the Order-Page incentive DISPLAY (the tier ladder + "add N more to save" nudge). These
// numbers do NOT take money off — that's Shopify. Keep them in sync with whatever the Shopify app is set
// to. `enabled` gates the whole display so it can never appear before the app is confirmed live —
// showing a discount that isn't applied at checkout is exactly the bug the old volume discount had.

export type VolumeTier = { minQty: number; pct: number }

export const VOLUME_DISCOUNT: { enabled: boolean; tiers: VolumeTier[] } = {
  enabled: false, // flip true ONLY after the Shopify tier app is installed AND confirmed applying at checkout
  tiers: [
    { minQty: 6, pct: 10 },
    { minQty: 12, pct: 15 },
    { minQty: 24, pct: 20 },
  ],
}

// The tier that applies at a given cart quantity (the highest threshold met), or null below the first.
export function currentTier(qty: number, tiers: VolumeTier[] = VOLUME_DISCOUNT.tiers): VolumeTier | null {
  let best: VolumeTier | null = null
  for (const t of tiers) if (qty >= t.minQty && (!best || t.minQty > best.minQty)) best = t
  return best
}

// The next tier up + how many more items to reach it, or null if already at the top tier.
export function nextTier(
  qty: number,
  tiers: VolumeTier[] = VOLUME_DISCOUNT.tiers,
): { tier: VolumeTier; needed: number } | null {
  const ups = tiers.filter(t => t.minQty > qty).sort((a, b) => a.minQty - b.minQty)
  if (ups.length === 0) return null
  return { tier: ups[0], needed: ups[0].minQty - qty }
}
