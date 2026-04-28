import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for webhook (no RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Shopify order/paid webhook payload
    const {
      id: shopifyOrderId,
      order_number: orderNumber,
      email,
      phone,
      billing_address,
      shipping_address,
      line_items,
      note_attributes,
    } = body

    // Find design_order_id from line item attributes
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

    // Also check note_attributes
    if (!designOrderId) {
      const attr = (note_attributes || []).find(
        (a: any) => a.name === '_design_order_id'
      )
      if (attr?.value) designOrderId = attr.value
    }

    if (!designOrderId) {
      return NextResponse.json({ message: 'No design order ID found' }, { status: 200 })
    }

    const customerName = billing_address
      ? `${billing_address.first_name || ''} ${billing_address.last_name || ''}`.trim()
      : email?.split('@')[0] || ''

    // Update design order with Shopify order info
    const { error } = await supabase
      .from('design_orders')
      .update({
        shopify_order_id: String(shopifyOrderId),
        shopify_order_number: String(orderNumber),
        customer_name: customerName,
        customer_email: email || '',
        customer_phone: phone || '',
        shipping_address: shipping_address || null,
        status: 'completed',
      })
      .eq('id', designOrderId)

    if (error) {
      console.error('Webhook update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log(`Order ${orderNumber} linked to design ${designOrderId}`)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
