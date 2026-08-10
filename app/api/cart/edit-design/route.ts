import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../../lib/customer-library'

export const runtime = 'nodejs'

// GET /api/cart/edit-design?order=<design_order_id>   (item 28 — Edit design from the cart)
//
// The Shopify cart's "Edit design" link points here carrying ONLY the line's `_design_order_id` property
// (all the theme easily has). We look up the order, assemble the full designer URL — product context so
// the garment loads, `design_id` to restore the saved canvas, and `replace_cart` so finishing the edit
// REPLACES the old cart line instead of duplicating — and 302 there. Centralizing this keeps the theme
// snippet a one-liner.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const order = url.searchParams.get('order') || ''
  const origin = url.origin
  if (!UUID_RE.test(order)) return NextResponse.redirect(`${origin}/?edit_error=bad-link`)

  const { data: d } = await serviceClient()
    .from('design_orders')
    .select('id, status, shopify_product_id, product_title, selected_color, unit_price')
    .eq('id', order)
    .maybeSingle()

  if (!d) return NextResponse.redirect(`${origin}/?edit_error=not-found`)
  // Already checked out → its design is locked; never let an edit fork a paid order.
  if (d.status === 'completed') return NextResponse.redirect(`${origin}/?edit_error=already-ordered`)

  // getProduct expects the BARE numeric product id (it GID-ifies internally); shopify_product_id is a GID.
  const productNumeric = d.shopify_product_id ? String(d.shopify_product_id).split('/').pop() ?? '' : ''
  const p = new URLSearchParams()
  if (productNumeric) p.set('product_id', productNumeric)
  if (d.product_title) p.set('title', d.product_title)
  if (d.unit_price != null) p.set('price', String(Math.round(Number(d.unit_price) * 100)))
  if (d.selected_color) p.set('color', d.selected_color)
  p.set('design_id', d.id)      // restore the saved canvas (edit-restore path)
  p.set('replace_cart', d.id)   // …and replace this order's cart line(s) when the edit finishes
  return NextResponse.redirect(`${origin}/designer?${p.toString()}`)
}
