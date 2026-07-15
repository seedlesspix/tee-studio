import { NextRequest, NextResponse } from 'next/server'
import { getStoreOrigin } from '../../../lib/shopify'

export const runtime = 'nodejs'

// Is a Print Charge variant actually addable to the cart?
//
// WHY THIS CHECKS THE ONLINE STORE AND NOT THE STOREFRONT API
// -----------------------------------------------------------
// Phase 3 sign-off failed with `Could not add to cart: Cannot find variant` while
// every shopify_variant_id in designer_pricing was present and EXACTLY matched
// Shopify. The Print Charge product simply wasn't published to the **Online
// Store** sales channel, and cart-add proxies to /cart/add.js — the Online Store.
// So the documented "must be set" rule guarded presence, not reachability.
//
// The obvious fix — validate via the Storefront API — is WRONG, and this store
// proves it: after publishing to Online Store, cart-add works while the
// Storefront API STILL returns null for those same variants, because the
// Storefront token's channel is a separate publication. A Storefront-based check
// would show red on a working config and train everyone to ignore it.
//
// So we check the same surface the cart uses: the Online Store's published
// catalog (/products.json). If a variant id isn't in there, /cart/add.js can't
// find it either. This is the method that actually located the bug.

const PAGE_SIZE = 250
const MAX_PAGES = 8 // 2000 products; the catalog is ~334 today

type ShopProduct = { variants?: { id: number }[] }

async function fetchPublishedVariantIds(storeOrigin: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `${storeOrigin}/products.json?limit=${PAGE_SIZE}&page=${page}`,
      // The catalog changes rarely; cache so opening the pricing admin doesn't
      // re-walk it every time.
      { next: { revalidate: 300 } },
    )
    if (!res.ok) break
    const data = (await res.json()) as { products?: ShopProduct[] }
    const products = data.products ?? []
    if (products.length === 0) break
    for (const p of products) {
      for (const v of p.variants ?? []) ids.add(String(v.id))
    }
    if (products.length < PAGE_SIZE) break
  }
  return ids
}

// GET /api/admin/variant-check?ids=123,456
//   -> { checked: true, missing: ["456"] }
//
// Only reads the store's PUBLIC published catalog, so there's nothing here a
// visitor couldn't already fetch themselves — no auth gate needed beyond the
// /admin area that calls it.
export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get('ids') ?? ''
  const ids = raw.split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
  if (ids.length === 0) return NextResponse.json({ checked: false, missing: [] })

  let storeOrigin: string
  try {
    storeOrigin = getStoreOrigin()
  } catch {
    // Misconfigured store domain: report "not checked" rather than flag every
    // row red — a badge that cries wolf is worse than no badge.
    return NextResponse.json({ checked: false, missing: [] })
  }

  try {
    const published = await fetchPublishedVariantIds(storeOrigin)
    // An empty catalog means the fetch was blocked/disabled, not that every
    // variant vanished. Fail closed on the BADGE, not on the config.
    if (published.size === 0) return NextResponse.json({ checked: false, missing: [] })
    return NextResponse.json({
      checked: true,
      missing: ids.filter(id => !published.has(id)),
    })
  } catch (err) {
    console.error('[variant-check] catalog fetch failed:', err)
    return NextResponse.json({ checked: false, missing: [] })
  }
}
