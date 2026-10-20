// Decision logic for /api/cron/stale-carts — PURE so it is unit-tested. Which abandoned "In Cart" /
// "Ordering" design_orders rows may be deleted, given the two fail-closed exclusions the caller computed:
//   savedIds       rows referenced by saved_designs (ON DELETE CASCADE — deleting one would silently
//                  destroy a customer's "My Designs" entry; the same 🚨 guard as the drafts cron)
//   liveDesignIds  rows whose ephemeral Shopify product STILL EXISTS (a live cart could still check it out)
export const STALE_CART_STATUSES = ['cart_created', 'ordering'] as const

export type StaleCandidate = { id: string; status: string | null; created_at: string | null }

export type StalePick = {
  deletable: string[]
  protectedBySavedDesigns: number
  protectedByLiveProduct: number
  deferredByCap: number
}

export function pickStaleOrders(args: {
  candidates: readonly StaleCandidate[]
  savedIds: ReadonlySet<string>
  liveDesignIds: ReadonlySet<string>
  cap: number
}): StalePick {
  let protectedBySavedDesigns = 0, protectedByLiveProduct = 0
  const ok: string[] = []
  for (const c of args.candidates) {
    if (!c.status || !(STALE_CART_STATUSES as readonly string[]).includes(c.status)) continue
    if (args.savedIds.has(c.id)) { protectedBySavedDesigns++; continue }
    if (args.liveDesignIds.has(c.id)) { protectedByLiveProduct++; continue }
    ok.push(c.id)
  }
  return {
    deletable: ok.slice(0, args.cap),
    protectedBySavedDesigns,
    protectedByLiveProduct,
    deferredByCap: Math.max(0, ok.length - args.cap),
  }
}
