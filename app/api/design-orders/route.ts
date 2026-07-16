import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../lib/customer-library'
import type { TablesInsert } from '@/types/database'

export const runtime = 'nodejs'

// Anonymous design-order creation (Phase 4 Days 2–3, BLOCKER-1 lockdown).
//
// POST /api/design-orders
//   Body: the designer's Next-Step row (canvas JSONs, pricing, print areas…).
//   Inserts a design_orders row via the SERVICE ROLE — the public RLS insert
//   policy is dropped. The route enforces what that policy's WITH CHECK used
//   to (and tightens it): status is FORCED to 'draft', and order-linkage/PII
//   columns are rejected outright, so an anonymous caller can never forge a
//   completed order or write customer data. Those columns are only ever
//   written by the Shopify webhook (service role) after a real paid order.
//
// The URL-as-key model is unchanged and deliberate (see CLAUDE.md): knowing a
// row's unguessable UUID grants access to that draft. What this lockdown
// removes is everything BEYOND that — listing/enumerating drafts and blanket
// updates via the anon key, which the old public policies allowed.

// Columns an anonymous caller may never set. Deny-list on purpose: the
// insertable column set drifts as phases add design fields (template ids,
// per-side charges…), but the protected set — order linkage + PII + status —
// is stable. Unknown junk keys are rejected by PostgREST anyway (400).
const PROTECTED_COLUMNS = [
  'status', // forced to 'draft' below
  'created_at', // set explicitly below (draft-cleanup cron relies on it)
  'shopify_order_id',
  'shopify_order_number',
  'shopify_cart_url',
  'customer_name',
  'customer_email',
  'customer_phone',
  'billing_address',
  'shipping_address',
] as const

// Canvas JSON embeds uploaded images as data URLs, so a design row can be a
// few MB. Same cap as /api/designs/draft.
const MAX_BYTES = 12 * 1024 * 1024

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  if (JSON.stringify(body).length > MAX_BYTES) {
    return NextResponse.json({ error: 'Design too large' }, { status: 413 })
  }

  // The designer generates the id client-side (storage paths under
  // <id>/uploads/ are written before this call), so accept it — but it must
  // be a UUID, and a duplicate insert fails (no overwriting existing rows).
  const id = typeof body.id === 'string' ? body.id : crypto.randomUUID()
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const row: Record<string, unknown> = { ...body }
  for (const col of PROTECTED_COLUMNS) delete row[col]
  row.id = id
  row.status = 'draft'
  row.created_at = new Date().toISOString()

  const supabase = serviceClient()
  const { error } = await supabase
    .from('design_orders')
    .insert(row as unknown as TablesInsert<'design_orders'>)

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Design already exists' }, { status: 409 })
    }
    console.error('[design-orders] insert failed:', error)
    return NextResponse.json({ error: 'Could not save design' }, { status: 500 })
  }

  return NextResponse.json({ id })
}
