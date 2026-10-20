import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'

export async function POST(request: NextRequest) {
  // 1. Validate required env vars exist (fail fast with a clear error)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Webhook: missing Supabase env vars')
    return NextResponse.json(
      { error: 'Server misconfigured: Supabase credentials missing' },
      { status: 500 }
    )
  }

  // Dual-secret HMAC (Phase 4 Day 1): webhooks registered by the Dev Dashboard
  // app via webhookSubscriptionCreate are signed with the APP CLIENT SECRET;
  // any admin-registered subscription is signed with the legacy store webhook
  // secret. Try both, log which matched — once prod logs show the client
  // secret consistently matching, SHOPIFY_WEBHOOK_SECRET retires.
  const secretCandidates: Array<[name: string, secret: string]> = []
  if (process.env.SHOPIFY_ADMIN_CLIENT_SECRET) {
    secretCandidates.push(['SHOPIFY_ADMIN_CLIENT_SECRET', process.env.SHOPIFY_ADMIN_CLIENT_SECRET])
  }
  if (process.env.SHOPIFY_WEBHOOK_SECRET) {
    secretCandidates.push(['SHOPIFY_WEBHOOK_SECRET', process.env.SHOPIFY_WEBHOOK_SECRET])
  }
  if (secretCandidates.length === 0) {
    console.error('Webhook: no webhook-signing secret configured (SHOPIFY_ADMIN_CLIENT_SECRET / SHOPIFY_WEBHOOK_SECRET)')
    return NextResponse.json(
      { error: 'Server misconfigured: webhook secret missing' },
      { status: 500 }
    )
  }

  // 2. Read raw body bytes — required for HMAC verification.
  //    Do NOT use request.json() here, it would re-serialize and break HMAC.
  const rawBody = await request.text()

  // 3. Verify HMAC signature against each candidate secret
  const headerHmac = request.headers.get('x-shopify-hmac-sha256')
  if (!headerHmac) {
    return NextResponse.json({ error: 'Missing HMAC header' }, { status: 401 })
  }

  const provided = Buffer.from(headerHmac, 'base64')
  const matched = secretCandidates.find(([, secret]) => {
    const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest()
    return computed.length === provided.length && timingSafeEqual(computed, provided)
  })

  if (!matched) {
    // Loud on purpose — repeated HMAC failures make Shopify auto-remove the
    // subscription, so this line is the canary.
    console.error(
      `Webhook: HMAC verification FAILED (topic=${request.headers.get('x-shopify-topic')}) — tried: ${secretCandidates.map(([n]) => n).join(', ')}`
    )
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 })
  }
  console.log(`Webhook: HMAC verified via ${matched[0]}`)

  // 4. Topics we act on: orders/paid (below) and orders/cancelled (here). Everything else is ACKed
  // with 200 so Shopify stops retrying.
  const topic = request.headers.get('x-shopify-topic')

  if (topic === 'orders/cancelled') {
    // A cancellation STAMPS the paid design row(s) — cancelled_at + cancel_reason — and changes nothing
    // else (Denise, 2026-10-20). Status stays 'completed' so the row remains admin-only, un-re-orderable
    // and cart-link-free; customer/shipping details stay for refunds and records; artwork is never
    // touched (reprints are indefinite); the checkout product ages out via the retention cron as usual.
    // Idempotent: re-delivery re-stamps the same values. Refunds and orders/updated are NOT handled here
    // on purpose — a partial refund is not a cancellation.
    let cancelBody: any
    try { cancelBody = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const cancelledOrderId = cancelBody?.id != null ? String(cancelBody.id) : ''
    const cancelledAt: string = typeof cancelBody?.cancelled_at === 'string' && cancelBody.cancelled_at ? cancelBody.cancelled_at : new Date().toISOString()
    const cancelReason: string | null = typeof cancelBody?.cancel_reason === 'string' && cancelBody.cancel_reason ? cancelBody.cancel_reason : null
    if (!cancelledOrderId) return NextResponse.json({ error: 'Missing order id' }, { status: 400 })
    const sb = createClient(supabaseUrl, serviceRoleKey)
    // Match the rows the paid webhook linked to this Shopify order. If the paid webhook was never
    // received (nothing to cancel on our side), fall back to the line items' _design_order_id — but
    // still only stamp rows that are actually paid; an unpaid In Cart row is left to the cleanup crons.
    let { data: rows, error: findErr } = await sb
      .from('design_orders').select('id, status').eq('shopify_order_id', cancelledOrderId)
    if (!findErr && (rows ?? []).length === 0) {
      const ids = [...new Set(((cancelBody?.line_items || []) as any[])
        .map((item) => (item.properties || []).find((p: any) => p.name === '_design_order_id')?.value)
        .filter((v: any): v is string => typeof v === 'string' && v.length > 0))]
      if (ids.length) ({ data: rows, error: findErr } = await sb.from('design_orders').select('id, status').in('id', ids))
    }
    if (findErr) {
      console.error('Webhook: orders/cancelled lookup failed:', findErr)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 }) // 500 → Shopify retries
    }
    const paidRows = (rows ?? []).filter((r) => r.status === 'completed')
    if (paidRows.length === 0) {
      console.log(`Webhook: orders/cancelled for Shopify order ${cancelledOrderId} matched no paid design rows — nothing to stamp`)
      return NextResponse.json({ message: 'No paid design rows for this order — skipped' }, { status: 200 })
    }
    const { error: stampErr } = await sb
      .from('design_orders')
      .update({ cancelled_at: cancelledAt, cancel_reason: cancelReason })
      .in('id', paidRows.map((r) => r.id))
      .eq('status', 'completed')
    if (stampErr) {
      console.error('Webhook: orders/cancelled stamp failed:', stampErr)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    console.log(`Webhook: orders/cancelled → stamped ${paidRows.length} design row(s) for Shopify order ${cancelledOrderId} (${cancelReason ?? 'no reason'})`)
    return NextResponse.json({ message: `Cancelled ${paidRows.length} design(s)` }, { status: 200 })
  }

  if (topic !== 'orders/paid') {
    return NextResponse.json({ message: `Ignored topic: ${topic}` }, { status: 200 })
  }

  // 5. Parse the verified body
  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    id: shopifyOrderId,
    order_number: orderNumber,
    email,
    phone,
    billing_address,
    shipping_address,
    // Fulfillment method, captured VERBATIM (Phase 4). For pickup the line's
    // title is the pickup location (e.g. "Bucktown"); for ship it's the
    // carrier (e.g. "UPS 3 Day Select®"). The pickup/ship discriminator is
    // derived in the admin display layer from this raw data, not guessed
    // here. This is the ONLY capture point — design-product orders are
    // invisible to the app via the Admin API, so it's unrecoverable if missed.
    shipping_lines,
    line_items,
  } = body

  // 6. Collect EVERY design_order_id in the order (Phase 4 Day 6: mixed
  // carts are first-class — one order can hold several designs alongside
  // off-the-shelf products; each design line carries its own id). Taking
  // only the first would leave later designs stranded in cart_created.
  const designOrderIds = [
    ...new Set(
      (line_items || [])
        .map((item: any) =>
          (item.properties || []).find((p: any) => p.name === '_design_order_id')?.value
        )
        .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
    ),
  ] as string[]

  if (designOrderIds.length === 0) {
    console.log(
      `Webhook: orders/paid for Shopify order ${orderNumber} (${shopifyOrderId}) had no _design_order_id — off-the-shelf-only order, skipped`
    )
    return NextResponse.json(
      { message: 'No design order ID found — order skipped' },
      { status: 200 }
    )
  }

  // 7. Update the design_orders row (service role bypasses RLS)
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // TODO: customerName fallback uses the email local-part (e.g. "jdoe" from "jdoe@gmail.com")
  // when billing_address is missing. This produces ugly names in admin. Decide later whether
  // to: (a) require billing_address from Shopify, (b) leave customer_name NULL, or (c) keep this fallback.
  const customerName = billing_address
    ? `${billing_address.first_name || ''} ${billing_address.last_name || ''}`.trim()
    : email?.split('@')[0] || ''

  // Reconcile the stored total to what Shopify ACTUALLY CHARGED. design_orders.total_price was frozen
  // pre-discount at cart-add (qty × folded price); the per-product volume-discount Function reduces the
  // amount at checkout, so without this the admin/bookkeeping total reads HIGH (and refunds would over-
  // credit). Per design, sum its line items' charged amount = price × quantity − total_discount (all
  // Shopify money strings). A mixed cart holds several design lines, so group by _design_order_id — the
  // same property already used to collect the ids above. Only overwrite when we get a finite number, so
  // a malformed payload leaves the pre-discount value rather than writing 0.
  const paidByDesign = new Map<string, number>()
  for (const item of (line_items || [])) {
    const did = (item.properties || []).find((p: any) => p.name === '_design_order_id')?.value
    if (typeof did !== 'string' || !did) continue
    const gross = Number(item.price) * Number(item.quantity)
    const disc = Number(item.total_discount || 0)
    if (!Number.isFinite(gross)) continue
    const net = gross - (Number.isFinite(disc) ? disc : 0)
    paidByDesign.set(did, (paidByDesign.get(did) || 0) + Math.max(0, net))
  }

  // One update per design row. Any failure → 500 so Shopify retries the
  // delivery; completed rows are naturally idempotent (same values re-set).
  const failures: string[] = []
  for (const designOrderId of designOrderIds) {
    const paid = paidByDesign.get(designOrderId)
    const { error } = await supabase
      .from('design_orders')
      .update({
        shopify_order_id: String(shopifyOrderId),
        shopify_order_number: String(orderNumber),
        customer_name: customerName,
        customer_email: email || '',
        customer_phone: phone || '',
        billing_address: billing_address || null,
        shipping_address: shipping_address || null,
        shipping_lines: shipping_lines ?? null,
        ...(paid != null && Number.isFinite(paid) ? { total_price: Number(paid.toFixed(2)) } : {}),
        status: 'completed',
      })
      .eq('id', designOrderId)

    if (error) {
      console.error(`Webhook update error for design ${designOrderId}:`, error)
      failures.push(designOrderId)
    } else {
      console.log(`Webhook: linked Shopify order ${orderNumber} → design ${designOrderId}`)
    }
  }

  if (failures.length > 0) {
    return NextResponse.json(
      { error: `Failed to update ${failures.length}/${designOrderIds.length} design(s)` },
      { status: 500 }
    )
  }
  return NextResponse.json({ success: true, designs: designOrderIds.length })
}
