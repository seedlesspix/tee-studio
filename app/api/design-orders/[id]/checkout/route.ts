import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../../../lib/customer-library'
import {
  createDesignProduct,
  publishToHeadless,
  createCartForDesign,
  deleteDesignProduct,
} from '../../../../lib/design-products'

export const runtime = 'nodejs'

// POST /api/design-orders/[id]/checkout   (Phase 4 Days 4–5)
//   Body: { quantities: Record<size, qty>, notes?: string | null }
//
// The Mechanism-A cart flow, one call: render the design as an ephemeral
// Shopify product (per-size variants, single price — closes BLOCKER-3),
// publish it to the Headless channel only (invisible on the Online Store),
// create a Storefront cart, persist the outcome on the design_orders row, and
// hand back the checkoutUrl. Replaces the old /cart/add.js + Print Charge
// line-item path — print charges are folded into the variant price
// (price_per_item), so checkout shows one honest per-shirt price.
//
// Failure is atomic toward Shopify: if the cart can't be created, the
// just-created product is deleted — no orphaned sellable products, no
// half-populated cart state.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: { quantities?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rawQuantities = body.quantities
  if (
    typeof rawQuantities !== 'object' || rawQuantities === null || Array.isArray(rawQuantities)
  ) {
    return NextResponse.json({ error: 'Invalid quantities' }, { status: 400 })
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data: design, error: fetchError } = await supabase
    .from('design_orders')
    .select('*')
    .eq('id', id)
    // same non-completed predicate as the sibling GET/PATCH handlers
    .or('status.is.null,status.neq.completed')
    .maybeSingle()

  if (fetchError) {
    console.error('[checkout] fetch failed:', fetchError)
    return NextResponse.json({ error: 'Could not load design' }, { status: 500 })
  }
  if (!design) {
    return NextResponse.json({ error: 'Design not found' }, { status: 404 })
  }

  // Sizes come from the design's captured available_sizes (Shopify variant
  // order). Quantities for unknown sizes are rejected, not dropped — a typo'd
  // size silently vanishing would under-ship the order.
  const sizes = design.available_sizes ?? []
  if (sizes.length === 0) {
    return NextResponse.json({ error: 'Design has no available sizes' }, { status: 422 })
  }
  const quantities: Record<string, number> = {}
  for (const [size, qty] of Object.entries(rawQuantities as Record<string, unknown>)) {
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: `Invalid quantity for size ${size}` }, { status: 400 })
    }
    if (qty === 0) continue
    if (!sizes.includes(size)) {
      return NextResponse.json({ error: `Unknown size: ${size}` }, { status: 400 })
    }
    quantities[size] = qty
  }
  const totalQty = Object.values(quantities).reduce((a, b) => a + b, 0)
  if (totalQty === 0) {
    return NextResponse.json({ error: 'No quantities selected' }, { status: 400 })
  }

  // Single per-shirt price: blank + print charges, captured at design time.
  const price = design.price_per_item ?? 0
  if (price <= 0) {
    return NextResponse.json(
      { error: 'Design has no price captured — re-save it from the designer' },
      { status: 422 }
    )
  }

  const previewUrls = [design.canvas_png_front, design.canvas_png_back].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('https://')
  )

  // 1. Ephemeral product (channel-invisible), sized to what's being ordered.
  const product = await createDesignProduct({
    designOrderId: id,
    title: `Custom ${design.product_title ?? 'Design'}`,
    price,
    sizes,
    previewUrls,
  }).catch((e: Error) => e)
  if (product instanceof Error) {
    console.error('[checkout] product creation failed:', product.message)
    return NextResponse.json({ error: 'Could not prepare checkout' }, { status: 502 })
  }

  try {
    // 2. Headless-only publish (Online Store never sees it).
    await publishToHeadless(product.productId)

    // 3. Storefront cart, one line per ordered size.
    const lines = Object.entries(quantities).map(([size, quantity]) => ({
      variantId: product.variantsBySize[size],
      quantity,
    }))
    const { checkoutUrl } = await createCartForDesign(id, lines)

    // 4. Persist the outcome (same allow-listed fields the PATCH handler
    // exposes, plus the cart URL). Failing to persist is logged but does not
    // fail the checkout — the customer's cart is real either way.
    const { error: updateError } = await supabase
      .from('design_orders')
      .update({
        quantities,
        total_qty: totalQty,
        total_price: Number((totalQty * price).toFixed(2)),
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : (body.notes ?? design.notes),
        status: 'cart_created',
        shopify_cart_url: checkoutUrl,
      })
      .eq('id', id)
      .in('status', ['draft', 'ordering', 'cart_created'])
    if (updateError) console.error('[checkout] persist failed:', updateError)

    return NextResponse.json({ checkoutUrl })
  } catch (e) {
    // Atomic toward Shopify: no cart → no product left behind.
    console.error('[checkout] failed after product creation:', e)
    await deleteDesignProduct(product.productId).catch((cleanupErr: Error) =>
      console.error('[checkout] cleanup delete failed:', cleanupErr.message)
    )
    return NextResponse.json({ error: 'Could not prepare checkout' }, { status: 502 })
  }
}
