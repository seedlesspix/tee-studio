import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../../../lib/customer-library'
import { getStoreOrigin } from '../../../../lib/shopify'
import {
  createDesignProduct,
  publishProduct,
  deleteDesignProduct,
  waitForMediaReady,
} from '../../../../lib/design-products'
import { type RosterEntry, entryHasContent, rosterValue, rosterShirtCount, rosterSizeQuantities } from '../../../../lib/namesNumbers'
import { resolveTiers, type VolumeTier } from '../../../../lib/volumeTiers'

export const runtime = 'nodejs'

// POST /api/design-orders/[id]/add-to-cart   (Phase 4 Day 6, revised shape)
//   Body: { quantities: Record<size, qty>, notes?: string | null }
//
// Joins a finished design to the CUSTOMER'S REAL storefront cart so it can
// mix with other designs and off-the-shelf products in one checkout:
//   1. render the design as an ephemeral product (per-size variants, single
//      folded price — one honest line per size, no Print Charge lines)
//   2. publish it to the Online Store (REQUIRED: carts have an owning
//      channel, and the session cart only accepts Online-Store-published
//      merchandise — probe-verified; seo.hidden keeps it out of search)
//   3. POST the customer's own /cart/add.js with their forwarded cookies —
//      one items[] request, all sizes, _design_order_id property per line
//      (that property is what the ORDERS_PAID webhook reads).
//
// This route MUST be called same-origin from the app on create.tshirtdeli.com:
// Shopify's cart cookie is scoped .tshirtdeli.com, so the browser sends it to
// us and we forward it. On any other origin (localhost, *.vercel.app) there
// are no store cookies — Shopify then creates a fresh cart and returns its
// cookie, which we relay back with the broadcast Domain (harmless in dev,
// correct in prod for first-time carts).
//
// Failure is atomic toward Shopify: if the cart-add fails, the just-created
// product is deleted — no orphaned sellable products.

// --- Cookie plumbing (resurrected from the retired /api/cart-add proxy — the
// create.tshirtdeli.com host-only-cookie bug is already solved here). ---

// Strip duplicate `cart=` entries, keeping the first occurrence: browsers
// send broadcast (older) cookies before host-only (newer) ones when paths
// are equal, so the first cart= is the cart the customer's other pages use.
function dedupeCartCookie(cookieHeader: string): string {
  let seenCart = false
  return cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter((entry) => {
      if (!entry) return false
      if (entry.split('=')[0] !== 'cart') return true
      if (seenCart) return false
      seenCart = true
      return true
    })
    .join('; ')
}

// "https://tshirtdeli.com" → ".tshirtdeli.com"
function getCookieDomain(storeOrigin: string): string {
  return `.${storeOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
}

// Rewrite a Shopify Set-Cookie so the browser stores it for the parent
// registrable domain (visible to all subdomains) instead of host-only on
// whoever served the response — which would be create.tshirtdeli.com.
function ensureCookieDomain(cookieString: string, domain: string): string {
  if (/;\s*Domain=/i.test(cookieString)) return cookieString
  return `${cookieString}; Domain=${domain}`
}

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
  if (typeof rawQuantities !== 'object' || rawQuantities === null || Array.isArray(rawQuantities)) {
    return NextResponse.json({ error: 'Invalid quantities' }, { status: 400 })
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
  }

  let storeOrigin: string
  try {
    storeOrigin = getStoreOrigin()
  } catch (err) {
    console.error('[add-to-cart] store domain misconfigured:', err)
    return NextResponse.json({ error: 'Store not configured' }, { status: 500 })
  }
  const cartUrl = `${storeOrigin}/cart`
  const forwardCookies = dedupeCartCookie(request.headers.get('cookie') ?? '')

  const supabase = serviceClient()
  const { data: design, error: fetchError } = await supabase
    .from('design_orders')
    .select('*')
    .eq('id', id)
    .or('status.is.null,status.neq.completed')
    .maybeSingle()

  if (fetchError) {
    console.error('[add-to-cart] fetch failed:', fetchError)
    return NextResponse.json({ error: 'Could not load design' }, { status: 500 })
  }
  if (!design) {
    return NextResponse.json({ error: 'Design not found' }, { status: 404 })
  }

  // Sizes from the design's captured available_sizes (Shopify variant order).
  // Unknown sizes are rejected, not dropped — silence would under-ship.
  const sizes = design.available_sizes ?? []
  if (sizes.length === 0) {
    return NextResponse.json({ error: 'Design has no available sizes' }, { status: 422 })
  }
  // Names & Numbers: a team order is one design × N personalized shirts, so the ROSTER on the design
  // row (not the per-size body quantities) is the source of truth — detected first so an N&N order
  // skips the per-size body validation entirely.
  const rosterEntries: RosterEntry[] = Array.isArray(design.roster)
    ? (design.roster as unknown as RosterEntry[]).filter(entryHasContent)
    : []
  const nnActive = rosterEntries.length > 0

  // Per-size body quantities — only for plain (non-N&N) designs.
  const quantities: Record<string, number> = {}
  if (!nnActive) {
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
    if (Object.values(quantities).reduce((a, b) => a + b, 0) === 0) {
      return NextResponse.json({ error: 'No quantities selected' }, { status: 400 })
    }
  }

  const price = design.price_per_item ?? 0
  if (price <= 0) {
    return NextResponse.json(
      { error: 'Design has no price captured — re-save it from the designer' },
      { status: 422 }
    )
  }

  if (nnActive) {
    // Never guess a size (Denise): block checkout and name the offending rows.
    const missing = rosterEntries.filter((e) => !e.size || !sizes.includes(e.size))
    if (missing.length) {
      const who = missing
        .slice(0, 6)
        .map((e) => rosterValue(e, 'name') || rosterValue(e, 'title') || (e.number ? `#${e.number}` : 'a row'))
        .join(', ')
      return NextResponse.json(
        { error: `Every roster row needs a size we offer before checkout. Please set a size for: ${who}.` },
        { status: 422 }
      )
    }
  }
  // Pricing is Option 1 — personalization is the printed side, already in price_per_item — so every
  // line (per size, or per roster entry) is price_per_item × qty. The roster drives N&N totals.
  const effQuantities = nnActive ? rosterSizeQuantities(rosterEntries) : quantities
  const effTotalQty = nnActive ? rosterShirtCount(rosterEntries) : Object.values(quantities).reduce((a, b) => a + b, 0)
  if (effTotalQty === 0) {
    return NextResponse.json({ error: 'No shirts to add — set at least one quantity.' }, { status: 400 })
  }

  // Idempotency: if this design is already a line in the customer's cart,
  // don't create a second product or double the lines — send them to the
  // cart, where quantities are edited natively.
  try {
    const cartRes = await fetch(`${storeOrigin}/cart.js`, {
      headers: { cookie: forwardCookies, accept: 'application/json' },
    })
    if (cartRes.ok) {
      const cart = (await cartRes.json()) as {
        items?: Array<{ properties?: Record<string, string> | null }>
      }
      const already = (cart.items ?? []).some((i) => i.properties?._design_order_id === id)
      if (already) {
        return NextResponse.json({ cartUrl, alreadyInCart: true })
      }
    }
  } catch {
    // Cart unreadable → proceed; worst case is the pre-Phase-4 retry
    // behavior (a duplicate line the customer can remove on the cart page).
  }

  const previewUrls = [design.canvas_png_front, design.canvas_png_back].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('https://')
  )

  // This garment's per-product volume ladder → stamped on the design product as the volume.tiers
  // metafield the discount Function reads at checkout. Resolved BY METHOD here (embroidery uses the
  // template's embroidery override when set; everything else uses the default ladder) so the metafield
  // carries the final ladder and the Function stays method-agnostic. Best-effort: a missing template /
  // no tiers just means no volume discount for this order (never blocks the cart-add).
  let volumeTiers: VolumeTier[] = []
  if (design.template_id) {
    const { data: tmpl } = await supabase
      .from('product_templates')
      .select('volume_tiers, volume_tiers_embroidery')
      .eq('id', design.template_id)
      .maybeSingle()
    volumeTiers = resolveTiers(design.print_method, tmpl?.volume_tiers, tmpl?.volume_tiers_embroidery)
  }

  // 1. Ephemeral product (per-size variants, folded price, seo.hidden, volume.tiers).
  const product = await createDesignProduct({
    designOrderId: id,
    title: `Custom ${design.product_title ?? 'Design'}`,
    price,
    sizes,
    previewUrls,
    volumeTiers,
  }).catch((e: Error) => e)
  if (product instanceof Error) {
    console.error('[add-to-cart] product creation failed:', product.message)
    return NextResponse.json({ error: 'Could not prepare your design for the cart' }, { status: 502 })
  }

  try {
    // 2. Online Store publish — the session cart's owning channel.
    await publishProduct(product.productId)

    // 2b. Wait (best-effort) for Shopify to finish processing the design preview so the cart line shows
    // the design immediately instead of a blank image. Overlaps with variant propagation (below), so it
    // usually costs nothing extra; capped + non-throwing, so a slow/failed render never blocks the add.
    await waitForMediaReady(product.productId)

    // 3. One items[] POST to the customer's own /cart/add.js. A just-
    // published variant can take a moment to reach the Online Store catalog
    // (Day-1/Day-6 probes: ~3-5s), so retry "Cannot find variant" briefly.
    // N&N: one line PER ROSTER ENTRY with VISIBLE Name/Number/Title so the coach proof-reads their
    // roster in the cart before paying (_design_order_id stays hidden with its underscore). Otherwise
    // the classic one-line-per-size shape, unchanged.
    const items = nnActive
      ? rosterEntries.map((e) => {
          const props: Record<string, string> = {}
          const nm = rosterValue(e, 'name'); if (nm) props.Name = nm
          if (e.number) props.Number = String(e.number)
          const tt = rosterValue(e, 'title'); if (tt) props.Title = tt
          props._design_order_id = id
          return {
            id: Number(product.variantsBySize[e.size].split('/').pop()),
            quantity: Math.max(1, Math.floor(e.qty) || 1),
            properties: props,
          }
        })
      : Object.entries(effQuantities).map(([size, quantity]) => ({
          id: Number(product.variantsBySize[size].split('/').pop()),
          quantity,
          properties: { _design_order_id: id },
        }))

    let addRes: Response | null = null
    let lastError = ''
    for (let attempt = 1; attempt <= 6; attempt++) {
      addRes = await fetch(`${storeOrigin}/cart/add.js`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          cookie: forwardCookies,
        },
        body: JSON.stringify({ items }),
      })
      if (addRes.ok) break
      const err = await addRes.json().catch(() => null)
      lastError = err?.description || err?.message || `HTTP ${addRes.status}`
      if (/cannot find variant/i.test(lastError) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      break
    }
    if (!addRes || !addRes.ok) {
      throw new Error(`cart-add failed: ${lastError}`)
    }

    // 4. Persist the outcome. Failure here is logged, not fatal — the
    // customer's cart line is real either way.
    const { error: updateError } = await supabase
      .from('design_orders')
      .update({
        quantities: effQuantities,
        total_qty: effTotalQty,
        total_price: Number((effTotalQty * price).toFixed(2)),
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : (body.notes ?? design.notes),
        status: 'cart_created',
        shopify_cart_url: cartUrl,
      })
      .eq('id', id)
      .in('status', ['draft', 'ordering', 'cart_created'])
    if (updateError) console.error('[add-to-cart] persist failed:', updateError)

    // 5. Relay Shopify's Set-Cookie (a fresh cart cookie when the customer
    // had none) with the broadcast Domain so every *.tshirtdeli.com page
    // sees the same cart.
    const response = NextResponse.json({ cartUrl })
    const cookieDomain = getCookieDomain(storeOrigin)
    for (const sc of addRes.headers.getSetCookie()) {
      response.headers.append('set-cookie', ensureCookieDomain(sc, cookieDomain))
    }
    return response
  } catch (e) {
    // Atomic toward Shopify: no cart line → no product left behind.
    console.error('[add-to-cart] failed after product creation:', e)
    await deleteDesignProduct(product.productId).catch((cleanupErr: Error) =>
      console.error('[add-to-cart] cleanup delete failed:', cleanupErr.message)
    )
    return NextResponse.json({ error: 'Could not add your design to the cart' }, { status: 502 })
  }
}
