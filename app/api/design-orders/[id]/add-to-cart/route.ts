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
// Worst realistic path ~25s (media-ready poll + the variant-readiness probe's propagation retries),
// which exceeds Vercel's default function timeout — a hard kill would skip the rollback catch and orphan
// a published product. 60s gives comfortable headroom so the request either completes or fails cleanly
// (product deleted). (Pro plan permits up to 300.)
export const maxDuration = 60

// POST /api/design-orders/[id]/add-to-cart   (Phase 4 Day 6; first-party hand-off 2026-08-10)
//   Body:    { quantities: Record<size, qty>, notes?, desired_by?, replaceDesignOrderId? }
//   Returns: { cartUrl, addUrl, items[], warning? }   (or { cartUrl, alreadyInCart })
//
// Joins a finished design to the CUSTOMER'S REAL storefront cart so it can mix with other designs and
// off-the-shelf products in one checkout. This route PREPARES the design; the BROWSER does the actual add:
//   1. render the design as an ephemeral product (per-size variants, single folded price — one honest
//      line per size, no Print Charge lines)
//   2. publish it to the Online Store (REQUIRED: carts have an owning channel, and the session cart only
//      accepts Online-Store-published merchandise — probe-verified; seo.hidden keeps it out of search)
//   3. PROBE that the just-published variant is catalog-ready, then return the line items[]. The order
//      page submits a TOP-LEVEL form to the STORE's /cart/add (return_to=/cart), so the STORE sets the
//      `cart` cookie FIRST-PARTY on tshirtdeli.com — the browser keeps it like any normal "Add to cart".
//
// WHY the browser adds (not us): we previously POSTed /cart/add.js server-side and RELAYED Shopify's cart
// cookie to the browser re-scoped to .tshirtdeli.com. Browsers stopped keeping that relayed cross-subdomain
// cookie after Shopify's new signed cart token (2026-08-10), so the item landed in a cart the browser
// didn't hold and checkout showed an empty cart. A first-party form add removes that dependency entirely,
// so no future Shopify cart-cookie change can break checkout the same way.
//
// Failure is atomic toward Shopify: if preparation fails, the just-created product is deleted — no
// orphaned sellable products.

// Strip duplicate `cart=` entries, keeping the first occurrence: browsers send broadcast (older)
// cookies before host-only (newer) ones when paths are equal, so the first cart= is the cart the
// customer's other pages use. Used only for the best-effort "already in cart?" read below — the add
// itself is now a first-party browser form to the store, so there is no cookie relay to plumb.
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: { quantities?: unknown; notes?: unknown; desired_by?: unknown; replaceDesignOrderId?: unknown; force?: unknown; acknowledged?: unknown }
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
  // Desired-by date (BETA #30): null or a plain YYYY-MM-DD calendar date.
  if (body.desired_by !== undefined && body.desired_by !== null && !(typeof body.desired_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.desired_by))) {
    return NextResponse.json({ error: 'Invalid desired_by' }, { status: 400 })
  }
  const desiredBy = typeof body.desired_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.desired_by) ? body.desired_by : null

  // Explicit "add another copy" from the order page's confirm — bypasses the already-in-cart guard below.
  const forceAdd = body.force === true
  // BETA #32 — the customer actively checked the pre-cart design acknowledgment. Persist WHEN they did as
  // dated proof (the order page blocks Add to Cart until it's ticked, so this is true on every real add).
  const acknowledgedAt = body.acknowledged === true ? new Date().toISOString() : null
  // Edit-from-cart (item 28): the ORIGINAL design row whose cart line(s) this add replaces (dormant until
  // the theme link ships). Hoisted here so the idempotency guard can exempt the intentional-re-add flow.
  const replaceId =
    typeof body.replaceDesignOrderId === 'string' && UUID_RE.test(body.replaceDesignOrderId) && body.replaceDesignOrderId !== id
      ? body.replaceDesignOrderId
      : null

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

  // Idempotency (first-party model). The store cart cookie is host-only on tshirtdeli.com and never
  // reaches create.tshirtdeli.com, so we can't read the live cart to dedupe. Use our OWN persisted status
  // instead: a design already handed off (status='cart_created') must NOT silently mint a SECOND
  // chargeable product/line on a repeat click or a browser-Back re-add — that is a real double-charge.
  // Route them to the cart to adjust quantity natively; the explicit "add another copy" (force) that the
  // order page confirms is the escape hatch. NOTE: this is NOT exempted for the edit-from-cart replace —
  // the EDITED design is always a fresh draft on its first add (so this never blocks the legit edit-add),
  // and on a browser-Back re-add the edited row IS now cart_created, so the guard correctly catches the
  // duplicate (a replace exemption here would silently double-charge — caught in item-28 review).
  if (!forceAdd && design.status === 'cart_created') {
    return NextResponse.json({ cartUrl, alreadyInCart: true })
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

  // Print Zones: include the extra zones' (sleeves/hat) preview PNGs so a sleeve-only design still gives
  // the cart product an image (front/back PNG columns are null there).
  const zonePngs: string[] = []
  {
    const z = design.zones
    if (z && typeof z === 'object' && !Array.isArray(z)) {
      for (const v of Object.values(z as Record<string, { canvas_png?: string | null }>)) {
        if (v?.canvas_png) zonePngs.push(v.canvas_png)
      }
    }
  }
  const previewUrls = [design.canvas_png_front, design.canvas_png_back, ...zonePngs].filter(
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

    // 3. Build the cart line items the browser will submit to the store. N&N: one line PER ROSTER ENTRY
    // with VISIBLE Name/Number/Title so the coach proof-reads their roster in the cart before paying
    // (_design_order_id stays hidden with its underscore). Otherwise the classic one-line-per-size shape.
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

    // Defensive: the guards above (per-size sum > 0 / roster shirt count > 0) guarantee ≥1 line, but the
    // probe and the client form both index items[0] — never hand off an empty add.
    if (items.length === 0) {
      throw new Error('no line items to add')
    }

    // 4. Confirm the just-published variant is catalog-ready. Online-Store publication propagates to the
    // cart surface ASYNCHRONOUSLY (~3-5s, Day-1/6 probes), so the browser's form POST could otherwise race
    // ahead and hit "Cannot find variant" with no retry. Probe with a THROWAWAY server-side cart (no
    // customer cookie — nothing touches their cart; the response is discarded), reusing the retry the old
    // inline add.js loop had. Once a probe succeeds the product is in the catalog, so the browser's own
    // /cart/add below is guaranteed to find every variant of it.
    let ready = false
    let lastError = ''
    for (let attempt = 1; attempt <= 6; attempt++) {
      const probe = await fetch(`${storeOrigin}/cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: items[0].id, quantity: 1 }] }),
      })
      if (probe.ok) { ready = true; break }
      const err = await probe.json().catch(() => null)
      lastError = err?.description || err?.message || `HTTP ${probe.status}`
      if (/cannot find variant/i.test(lastError) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      break
    }
    if (!ready) throw new Error(`variant not ready: ${lastError}`)

    // EDIT-FROM-CART (item 28), first-party model: the browser adds the EDITED design as a normal new
    // line; we cannot remove the OLD line for them from this subdomain (the store cart cookie is
    // first-party on tshirtdeli.com and never reaches create.tshirtdeli.com), so we warn them to remove it
    // on the cart page — they see both lines, so there is no silent double-charge. Seamless first-party
    // removal is a follow-up for when the edit-from-cart link actually ships. Normal adds carry no warning.
    const warning = replaceId
      ? 'Your edited design will be added as a new line. Your previous version is still in the cart — please remove that older line before checkout.'
      : null

    // 5. Persist the outcome (optimistic — the browser completes the add next). Non-fatal: the design row
    // is the source of truth, and the ORDERS_PAID webhook reconciles the real order on payment.
    const { error: updateError } = await supabase
      .from('design_orders')
      .update({
        quantities: effQuantities,
        total_qty: effTotalQty,
        total_price: Number((effTotalQty * price).toFixed(2)),
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : (body.notes ?? design.notes),
        desired_by: desiredBy,
        ...(acknowledgedAt ? { design_acknowledged_at: acknowledgedAt } : {}),
        status: 'cart_created',
        shopify_cart_url: cartUrl,
      })
      .eq('id', id)
      .in('status', ['draft', 'ordering', 'cart_created'])
    if (updateError) console.error('[add-to-cart] persist failed:', updateError)

    // 6. Hand the browser the line items. The order page submits a TOP-LEVEL form to the STORE's /cart/add
    // (return_to=/cart), so the STORE sets the cart cookie FIRST-PARTY — no cross-subdomain cookie relay
    // for the browser to drop (the drop that was emptying carts).
    return NextResponse.json({ cartUrl, addUrl: `${storeOrigin}/cart/add`, items, ...(warning ? { warning } : {}) })
  } catch (e) {
    // Atomic toward Shopify: no cart line → no product left behind.
    console.error('[add-to-cart] failed after product creation:', e)
    await deleteDesignProduct(product.productId).catch((cleanupErr: Error) =>
      console.error('[add-to-cart] cleanup delete failed:', cleanupErr.message)
    )
    return NextResponse.json({ error: 'Could not add your design to the cart' }, { status: 502 })
  }
}
