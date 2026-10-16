import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../lib/supabase/server'
import { getFeaturedImages } from '../../lib/shopify'
import { normalizeShopifyProductId } from '../../lib/productImages'
import { rateLimit, clientIp } from '../../lib/server/rateLimit'
import {
  parseDesignNumber, parseGarmentRef, matchesStyle, methodsCompatible, compareTemplates, bareProductId,
} from '../../lib/deepLink'

// Grab 'n Go deep-link resolver (2026-10-16). Turns the theme's ?design=T2491[&garment=3001] into what
// the designer needs: the art to place (by design number) and the garment to open on (by style number,
// else the DEFAULT garment). Public read only — both tables' RLS already hides inactive rows from the
// anon key, which is exactly the "unknown or inactive → open normally" rule. Never errors on bad input:
// an unparseable or unknown design/garment is simply null in the response.
//
//   GET /api/deep-link?design=T2491&garment=3001
//   → { design: { number, name, fileUrl, fileType, supportedMethods } | null,
//       garment: { templateId, productId (bare), gid, title, matched } | null }
//
// garment.matched = true when ?garment= resolved to a usable template; false when this is the default
// (first in the admin's picker order — decision 4) so the designer knows to open the picker.
// Decision 6: a garment that can't produce the design (no shared print method) is never returned.

export const dynamic = 'force-dynamic'

type Tpl = {
  id: string; name: string; style_number: string | null; shopify_product_id: string
  supported_print_methods: string[] | null; sort_order: number | null; created_at: string | null
}

export async function GET(request: NextRequest) {
  // Light abuse guard: this is a cheap read, but it is public and does a Storefront call.
  const rl = rateLimit(`deep-link:${clientIp(request.headers)}`, 120, 60_000)
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const params = request.nextUrl.searchParams
  const designNumber = parseDesignNumber(params.get('design'))
  const garmentRef = parseGarmentRef(params.get('garment'))

  try {
    const supabase = await createClient()

    // ---- The design (art) ----
    let design: { number: number; name: string; fileUrl: string; fileType: string; supportedMethods: string[] } | null = null
    if (designNumber != null) {
      const { data } = await supabase
        .from('clipart_items')
        .select('id, name, file_url, file_type, decal_number, supported_methods, sort_order')
        .eq('decal_number', designNumber)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
      const row = data?.[0]
      if (row?.file_url) {
        design = {
          number: designNumber,
          name: row.name,
          fileUrl: row.file_url,
          fileType: row.file_type ?? 'image',
          supportedMethods: row.supported_methods ?? [],
        }
      }
    }

    // ---- The garment ----
    const { data: tplRows } = await supabase
      .from('product_templates')
      .select('id, name, style_number, shopify_product_id, supported_print_methods, sort_order, created_at')
      .eq('is_active', true)
    const templates = ((tplRows ?? []) as Tpl[])
      .filter(t => !!t.shopify_product_id)
      .sort(compareTemplates)

    // Only garments that can produce this art (fail open when the art is unknown / has no methods).
    const compatible = templates.filter(t => methodsCompatible(design?.supportedMethods, t.supported_print_methods))

    // Which of those actually resolve to a live Shopify product (deleted/unpublished would dead-end the
    // customer on the "unavailable" screen). One batched Storefront call; null = call failed → fail open.
    const gidOf = (t: Tpl) => normalizeShopifyProductId(t.shopify_product_id)
    const { available } = await getFeaturedImages(compatible.map(gidOf).filter((g): g is string => !!g))
    const isLive = (t: Tpl) => {
      const g = gidOf(t)
      return !!g && (available == null || available.has(g))
    }
    const usable = compatible.filter(isLive)

    let picked: Tpl | null = null
    let matched = false
    if (garmentRef) {
      const byRef = usable.filter(t => {
        if (garmentRef.kind === 'style') return matchesStyle(t.style_number, garmentRef.token)
        if (garmentRef.kind === 'template') return t.id.toLowerCase() === garmentRef.id
        return gidOf(t) === garmentRef.gid
      })
      if (byRef.length) { picked = byRef[0]; matched = true }
    }
    if (!picked) picked = usable[0] ?? null // decision 4: first in the admin's picker order

    const gid = picked ? gidOf(picked) : null
    const garment = picked && gid
      ? { templateId: picked.id, productId: bareProductId(gid), gid, title: picked.name, matched }
      : null

    return NextResponse.json({ design, garment }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[deep-link] resolve failed:', err)
    // Never an error page for the customer: the designer treats nulls as "open normally".
    return NextResponse.json({ design: null, garment: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
