import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serviceClient } from '../../../lib/customer-library'
import { listDesignProducts } from '../../../lib/design-products'
import { STALE_CART_MIN_AGE_DAYS } from '../../../lib/retention'
import { pickStaleOrders, STALE_CART_STATUSES } from '../../../lib/staleOrders'

export const runtime = 'nodejs'
export const maxDuration = 300

// GET /api/cron/stale-carts[?dry_run=1]   (Denise, 2026-10-20)
//
// Ages out abandoned "In Cart" (status='cart_created') and "Ordering" rows in design_orders — the
// sibling of /api/cron/drafts, which deliberately leaves these statuses alone because a row that sits in
// a live Shopify cart can STILL complete: the orders/paid webhook looks the row up by id, and if it were
// gone the order would land with no design data (unfulfillable). So this job has THREE gates, all of
// which must pass, and two of which fail CLOSED:
//
//   1. AGE      — older than STALE_CART_MIN_AGE_DAYS (15): beyond the product retention window.
//   2. PRODUCT  — the row's ephemeral Shopify product is GONE (not in the live tagged listing). If the
//                 listing fails, nothing deletes. A cart cannot check out a deleted product, so a row with
//                 no product can never complete.
//   3. 🚨 SAVED — not referenced by saved_designs (ON DELETE CASCADE: a naive delete would silently
//                 destroy a customer's "My Designs" entry). If the exclusion query fails, nothing deletes.
//
// Status is re-asserted at delete time so a row that completed mid-run survives. Per-run cap; ?dry_run=1
// reports without deleting. Auth: Authorization: Bearer CRON_SECRET (fails closed when unset).

const MAX_DELETES_PER_RUN = 200

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1'
  const cutoff = new Date(Date.now() - STALE_CART_MIN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const supabase = serviceClient()

  // 1. AGE: old In Cart / Ordering rows.
  const { data: candidates, error: candErr } = await supabase
    .from('design_orders')
    .select('id, status, created_at')
    .in('status', [...STALE_CART_STATUSES])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500)
  if (candErr) {
    console.error('[stale-carts] candidate query failed:', candErr)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }
  const candidateIds = (candidates ?? []).map((c) => c.id)

  // 2. PRODUCT (fail closed): which design rows still have a live product?
  let liveDesignIds: Set<string>
  try {
    const products = await listDesignProducts()
    liveDesignIds = new Set(products.map((p) => p.designOrderId).filter((v): v is string => !!v))
  } catch (e) {
    console.error('[stale-carts] product listing failed — aborting, nothing deleted:', e)
    return NextResponse.json({ error: 'Product listing failed — no deletions' }, { status: 500 })
  }

  // 3. SAVED (fail closed): the saved_designs anti-join.
  let savedIds = new Set<string>()
  if (candidateIds.length > 0) {
    const { data: saved, error: savedErr } = await supabase
      .from('saved_designs')
      .select('design_order_id')
      .in('design_order_id', candidateIds)
    if (savedErr) {
      console.error('[stale-carts] saved_designs exclusion query failed — aborting:', savedErr)
      return NextResponse.json({ error: 'Exclusion query failed — no deletions' }, { status: 500 })
    }
    savedIds = new Set((saved ?? []).map((s) => s.design_order_id))
  }

  const pick = pickStaleOrders({ candidates: candidates ?? [], savedIds, liveDesignIds, cap: MAX_DELETES_PER_RUN })

  // 4. Delete in chunks (unless dry run), re-asserting status.
  let deleted = 0
  if (!dryRun && pick.deletable.length > 0) {
    for (let i = 0; i < pick.deletable.length; i += 100) {
      const chunk = pick.deletable.slice(i, i + 100)
      const { error: delErr } = await supabase
        .from('design_orders')
        .delete()
        .in('id', chunk)
        .in('status', [...STALE_CART_STATUSES])
      if (delErr) {
        console.error('[stale-carts] delete chunk failed:', delErr)
        return NextResponse.json({ error: 'Delete failed partway', deleted }, { status: 500 })
      }
      deleted += chunk.length
    }
  }

  const summary = {
    dryRun,
    cutoff,
    minAgeDays: STALE_CART_MIN_AGE_DAYS,
    candidates: candidateIds.length,
    liveProductsOnStore: liveDesignIds.size,
    protectedByLiveProduct: pick.protectedByLiveProduct,
    protectedBySavedDesigns: pick.protectedBySavedDesigns,
    deleted: dryRun ? 0 : deleted,
    wouldDelete: dryRun ? pick.deletable.length : undefined,
    deferredByCap: pick.deferredByCap,
  }
  console.log(`[stale-carts]${dryRun ? ' (dry)' : ''}`, JSON.stringify(summary))
  return NextResponse.json(summary)
}
