import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../../lib/customer-library'

export const runtime = 'nodejs'

// GET /api/cart/edit-design?order=<design_order_id>&line=<cart_line_key>   (item 28 — Edit design from cart)
//
// The Shopify cart's "Edit design" link points here carrying the line's `_design_order_id` property AND
// its cart line `key` (both available in the cart line loop). We look up the order and assemble the full
// designer URL — product context so the garment loads, `design_id` to restore the saved canvas,
// `replace_cart` (the order id) and `replace_line` (the cart line key) so finishing the edit REPLACES the
// old cart line first-party instead of duplicating — and 302 there. The `line` key is what lets the order
// page remove that exact line (create.tshirtdeli.com can't read the store cart to find it). Backward
// compatible: an old link with no `line` falls back to the "remove the old line yourself" warning.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const order = url.searchParams.get('order') || ''
  const line = url.searchParams.get('line') || '' // the cart line KEY (variantid:hash) — for seamless replace
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
  if (line) p.set('replace_line', line) // the exact cart line key to remove first-party (seamless replace)
  return NextResponse.redirect(`${origin}/designer?${p.toString()}`)
}
