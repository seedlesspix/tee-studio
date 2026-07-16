import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serviceClient } from '../../../lib/customer-library'
import { adminGraphQL } from '../../../lib/shopify-admin'
import { deleteDesignProduct, DESIGN_PRODUCT_TAG } from '../../../lib/design-products'

export const runtime = 'nodejs'
// Paginated Shopify reads + per-order lookups can take a moment.
export const maxDuration = 300

// GET /api/cron/retention[?dry_run=1]   (Phase 4 Day 7)
//
// Deletes ephemeral `Custom Design` Shopify products whose job is done.
// ⚠ HIGHEST-CONSEQUENCE JOB IN THE PHASE: productDelete SILENTLY EMPTIES any
// live cart holding the product (Day-1 probe 7b), so there is exactly ONE
// gate, chosen deliberately conservative:
//
//   EXPIRY GATE — the product is ≥ RETENTION_DAYS (14) old, beyond Shopify's
//   ~10-day maximum cart lifetime plus buffer. NOTHING that could still sit
//   in a live cart is ever deleted, regardless of order state. Paid orders'
//   products simply age out too: the order snapshots its line items and
//   fulfillment reads design_orders, so the lingering product costs nothing
//   (hidden from search/collections; direct-URL window is the accepted
//   residual).
//
// A per-order "paid gate" (delete immediately once purchased) was designed
// and then REMOVED: it required reading the order's line items, and orders
// containing design products are currently whole-object INVISIBLE to this
// app (see BUILD_PLAN "order visibility" item) — a deletion gate cannot
// depend on a surface that lies. Revisit only after that item resolves.
//
// Anything not passing the gate is KEPT and reported. Reorder-recreates means a
// deleted product regrows on the next Add to Cart — deletion never loses work
// (the design lives in design_orders).
//
// Runs on Vercel Cron. Auth: Authorization: Bearer CRON_SECRET (fails closed
// when unset). ?dry_run=1 reports every decision without deleting anything.

const RETENTION_DAYS = 14
const MAX_DELETES_PER_RUN = 50

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

type ProductNode = {
  id: string
  title: string
  handle: string
  createdAt: string
  tags: string[]
}

type Decision = {
  productId: string
  handle: string
  designOrderId: string | null
  decision: 'DELETE' | 'KEEP'
  gate: 'expired' | 'orphan-expired' | 'awaiting-gate' | 'orphan-young' | 'cap-reached'
  detail: string
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1'
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000

  // 1. Every design product on the store (paginated).
  const products: ProductNode[] = []
  let cursor: string | null = null
  for (let page = 0; page < 10; page++) {
    const data: {
      products: {
        nodes: ProductNode[]
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    } = await adminGraphQL(
      `query($q: String!, $cursor: String) {
        products(first: 100, query: $q, after: $cursor) {
          nodes { id title handle createdAt tags }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q: `tag:${DESIGN_PRODUCT_TAG}`, cursor }
    )
    products.push(...data.products.nodes)
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
  }

  // 2. Their design rows, one query.
  const designIds = products
    .map((p) => p.tags.find((t) => t.startsWith('design_order:'))?.slice('design_order:'.length))
    .filter((v): v is string => !!v)
  const supabase = serviceClient()
  const { data: rows, error } = designIds.length
    ? await supabase.from('design_orders').select('id, status').in('id', designIds)
    : { data: [], error: null }
  if (error) {
    console.error('[retention] design_orders lookup failed:', error)
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 })
  }
  const rowById = new Map((rows ?? []).map((r) => [r.id, r]))

  // 3. Decide, then (unless dry run) delete.
  const decisions: Decision[] = []
  let deletes = 0
  for (const p of products) {
    const designOrderId =
      p.tags.find((t) => t.startsWith('design_order:'))?.slice('design_order:'.length) ?? null
    const row = designOrderId ? rowById.get(designOrderId) : undefined
    const ageMs = Date.now() - new Date(p.createdAt).getTime()
    const expired = new Date(p.createdAt).getTime() < cutoff
    const ageDays = (ageMs / 86_400_000).toFixed(1)

    let decision: Decision
    if (!designOrderId || !row) {
      // Orphan: no design tag, or the design row is gone (smoke cleanup,
      // future admin deletes). Young orphans are kept — could be an insert
      // race — and age out via the expiry gate.
      decision = expired
        ? { productId: p.id, handle: p.handle, designOrderId, decision: 'DELETE', gate: 'orphan-expired', detail: `no design row; ${ageDays}d old` }
        : { productId: p.id, handle: p.handle, designOrderId, decision: 'KEEP', gate: 'orphan-young', detail: `no design row; only ${ageDays}d old` }
    } else if (expired) {
      decision = { productId: p.id, handle: p.handle, designOrderId, decision: 'DELETE', gate: 'expired', detail: `status=${row.status}; ${ageDays}d old ≥ ${RETENTION_DAYS}d (cart lifetime ~10d)` }
    } else {
      decision = { productId: p.id, handle: p.handle, designOrderId, decision: 'KEEP', gate: 'awaiting-gate', detail: `status=${row.status}; ${ageDays}d old < ${RETENTION_DAYS}d — a cart may still hold it` }
    }

    if (decision.decision === 'DELETE') {
      if (deletes >= MAX_DELETES_PER_RUN) {
        decision = { ...decision, decision: 'KEEP', gate: 'cap-reached', detail: `${decision.detail} (deferred: ${MAX_DELETES_PER_RUN}/run cap)` }
      } else {
        deletes++
        if (!dryRun) {
          try {
            await deleteDesignProduct(p.id)
          } catch (e) {
            decision = { ...decision, decision: 'KEEP', gate: 'awaiting-gate', detail: `delete FAILED: ${e instanceof Error ? e.message : e}` }
            deletes--
          }
        }
      }
    }
    decisions.push(decision)
    console.log(`[retention]${dryRun ? ' (dry)' : ''} ${decision.decision} ${p.handle} — ${decision.gate}: ${decision.detail}`)
  }

  return NextResponse.json({
    dryRun,
    scanned: products.length,
    deleted: dryRun ? 0 : deletes,
    wouldDelete: dryRun ? deletes : undefined,
    kept: decisions.filter((d) => d.decision === 'KEEP').length,
    decisions,
  })
}
