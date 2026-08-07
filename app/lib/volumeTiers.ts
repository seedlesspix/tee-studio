// Volume-pricing tiers (BETA item 14) — PER-PRODUCT.
//
// Each garment carries its own tier ladder in product_templates.volume_tiers (different garments break
// at different quantities). The ACTUAL discount is enforced at CHECKOUT by a Shopify product-discount
// Function that reads a `volume.tiers` metafield stamped on the ephemeral design product (that metafield
// is a copy of the template's tiers, set at add-to-cart). This module is the SHARED tier math used by:
//   • the admin template editor (normalize/validate a garment's ladder),
//   • add-to-cart / createDesignProduct (serialize tiers → the metafield the Function reads),
//   • the Order-Page incentive DISPLAY (the ladder + "add N more to save" nudge).
//
// ⚠ The Order-Page numbers do NOT take money off — Shopify's Function does, at checkout. `enabled` gates
// the whole DISPLAY so a discount can never be shown before the Function is confirmed live (showing a
// discount that isn't applied at checkout is exactly the bug the old volume discount had).

export type VolumeTier = { minQty: number; pct: number }

export const VOLUME_DISCOUNT: { enabled: boolean } = {
  enabled: false, // flip true ONLY after the Shopify discount Function is deployed AND confirmed at checkout
}

// Coerce an unknown value (jsonb column, metafield JSON, admin draft) into clean, sorted tiers.
// Drops anything that isn't a positive-integer minQty with a 0<pct<100. Sorted ascending by minQty,
// de-duped on minQty (last wins). Returns [] for null/garbage — the "no volume discount" signal.
export function normalizeTiers(raw: unknown): VolumeTier[] {
  let arr: unknown = raw
  if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { return [] } }
  if (!Array.isArray(arr)) return []
  const byMin = new Map<number, number>()
  for (const t of arr) {
    if (!t || typeof t !== 'object') continue
    const minQty = Number((t as Record<string, unknown>).minQty)
    const pct = Number((t as Record<string, unknown>).pct)
    if (!Number.isFinite(minQty) || !Number.isFinite(pct)) continue
    const mq = Math.floor(minQty), p = Math.round(pct)
    if (mq < 2 || p <= 0 || p >= 100) continue // minQty 1 is meaningless; pct must be a real 1..99
    byMin.set(mq, p)
  }
  return [...byMin.entries()].map(([minQty, pct]) => ({ minQty, pct })).sort((a, b) => a.minQty - b.minQty)
}

// The tier that applies at a given cart quantity (the highest threshold met), or null below the first.
export function currentTier(qty: number, tiers: VolumeTier[]): VolumeTier | null {
  let best: VolumeTier | null = null
  for (const t of tiers) if (qty >= t.minQty && (!best || t.minQty > best.minQty)) best = t
  return best
}

// The next tier up + how many more items to reach it, or null if already at the top tier.
export function nextTier(qty: number, tiers: VolumeTier[]): { tier: VolumeTier; needed: number } | null {
  const ups = tiers.filter(t => t.minQty > qty).sort((a, b) => a.minQty - b.minQty)
  if (ups.length === 0) return null
  return { tier: ups[0], needed: ups[0].minQty - qty }
}
