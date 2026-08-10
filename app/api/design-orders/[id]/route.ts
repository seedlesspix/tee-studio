import { NextRequest, NextResponse } from 'next/server'
import { serviceClient, UUID_RE } from '../../../lib/customer-library'
import type { TablesUpdate } from '@/types/database'

export const runtime = 'nodejs'

// Read/update a single design order by its unguessable UUID (Phase 4 Days 2–3,
// BLOCKER-1 lockdown). Both handlers run on the SERVICE ROLE — the public RLS
// read/update policies are dropped — and re-enforce exactly what those
// policies used to, minus the hole:
//
//   GET   — serves any NON-completed row (the old read policy's predicate),
//           but only by exact UUID. No listing surface exists anymore, so
//           drafts are no longer enumerable via the anon key.
//   PATCH — order-page fields only (quantities/totals/notes/status/cart url),
//           and only while the row is in draft|ordering|cart_created — the old
//           update policy's predicate. Completed rows (webhook-owned, PII)
//           stay untouchable from the browser.

// The order flow's only legal status writes. 'completed' is the webhook's.
const PATCHABLE_STATUSES = ['ordering', 'cart_created'] as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('design_orders')
    .select('*')
    .eq('id', id)
    // Old public-read predicate: (status IS NULL) OR (status <> 'completed').
    // Completed rows carry customer PII and 404 here (not 403 — don't leak
    // that the id exists).
    .or('status.is.null,status.neq.completed')
    .maybeSingle()

  if (error) {
    console.error('[design-orders] fetch failed:', error)
    return NextResponse.json({ error: 'Could not load design' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Design not found' }, { status: 404 })
  }
  return NextResponse.json({ order: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Allow-list, field by field — nothing else on the row is order-page
  // territory. Unknown keys are ignored rather than errored so adding UI
  // fields later fails safe (silently unsaved beats silently writable).
  const patch: TablesUpdate<'design_orders'> = {}
  if (body.quantities !== undefined) {
    if (typeof body.quantities !== 'object' || body.quantities === null || Array.isArray(body.quantities)) {
      return NextResponse.json({ error: 'Invalid quantities' }, { status: 400 })
    }
    patch.quantities = body.quantities as TablesUpdate<'design_orders'>['quantities']
  }
  if (body.total_qty !== undefined) {
    if (typeof body.total_qty !== 'number') {
      return NextResponse.json({ error: 'Invalid total_qty' }, { status: 400 })
    }
    patch.total_qty = body.total_qty
  }
  if (body.total_price !== undefined) {
    if (typeof body.total_price !== 'number') {
      return NextResponse.json({ error: 'Invalid total_price' }, { status: 400 })
    }
    patch.total_price = body.total_price
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
    }
    patch.notes = body.notes
  }
  if (body.desired_by !== undefined) { // BETA #30 — null or a plain YYYY-MM-DD date
    if (body.desired_by !== null && !(typeof body.desired_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.desired_by))) {
      return NextResponse.json({ error: 'Invalid desired_by' }, { status: 400 })
    }
    patch.desired_by = body.desired_by as string | null
  }
  if (body.shopify_cart_url !== undefined) {
    if (body.shopify_cart_url !== null && typeof body.shopify_cart_url !== 'string') {
      return NextResponse.json({ error: 'Invalid shopify_cart_url' }, { status: 400 })
    }
    patch.shopify_cart_url = body.shopify_cart_url
  }
  if (body.status !== undefined) {
    if (!PATCHABLE_STATUSES.includes(body.status as (typeof PATCHABLE_STATUSES)[number])) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = body.status as string
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('design_orders')
    .update(patch)
    .eq('id', id)
    // Old public-update predicate: only rows still in the order flow.
    .in('status', ['draft', 'ordering', 'cart_created'])
    .select('id')

  if (error) {
    console.error('[design-orders] update failed:', error)
    return NextResponse.json({ error: 'Could not update design' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    // Missing id, or a completed/locked row — same 404 either way.
    return NextResponse.json({ error: 'Design not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
