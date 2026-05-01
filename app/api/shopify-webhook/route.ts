import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHmac, timingSafeEqual } from 'node:crypto'

export async function POST(request: NextRequest) {
  // 1. Validate required env vars exist (fail fast with a clear error)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Webhook: missing Supabase env vars')
    return NextResponse.json(
      { error: 'Server misconfigured: Supabase credentials missing' },
      { status: 500 }
    )
  }
  if (!webhookSecret) {
    console.error('Webhook: missing SHOPIFY_WEBHOOK_SECRET')
    return NextResponse.json(
      { error: 'Server misconfigured: webhook secret missing' },
      { status: 500 }
    )
  }

  // 2. Read raw body bytes — required for HMAC verification.
  //    Do NOT use request.json() here, it would re-serialize and break HMAC.
  const rawBody = await request.text()

  // 3. Verify HMAC signature
  const headerHmac = request.headers.get('x-shopify-hmac-sha256')
  if (!headerHmac) {
    return NextResponse.json({ error: 'Missing HMAC header' }, { status: 401 })
  }

  const computed = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest()
  const provided = Buffer.from(headerHmac, 'base64')

  if (computed.length !== provided.length || !timingSafeEqual(computed, provided)) {
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 })
  }

  // 4. Only act on orders/paid. ACK other topics with 200 so Shopify stops retrying.
  const topic = request.headers.get('x-shopify-topic')
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
    line_items,
  } = body

  // 6. Find design_order_id from line item attributes
  let designOrderId: string | null = null
  for (const item of line_items || []) {
    const attr = (item.properties || []).find(
      (p: any) => p.name === '_design_order_id'
    )
    if (attr?.value) {
      designOrderId = attr.value
      break
    }
  }

  if (!designOrderId) {
    console.error(
      `Webhook: orders/paid for Shopify order ${orderNumber} (${shopifyOrderId}) had no _design_order_id — likely a non-Tee-Studio product`
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
      status: 'completed',
    })
    .eq('id', designOrderId)

  if (error) {
    console.error('Webhook update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`Webhook: linked Shopify order ${orderNumber} → design ${designOrderId}`)
  return NextResponse.json({ success: true })
}
