import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serviceClient } from '../../../lib/customer-library'

export const runtime = 'nodejs'
export const maxDuration = 120

// GET /api/cron/drafts[?dry_run=1]   (Phase 4 Day 7)
//
// Ages out abandoned design_orders drafts: every login-from-designer and
// every Next Step writes a status='draft' row, and abandoned ones accumulate
// forever (known since Phase 1).
//
// 🚨 THE SAVED-DESIGNS EXCLUSION IS THE WHOLE JOB 🚨
// A customer's "My Designs" entry points at a design_orders row that is
// STILL status='draft', and saved_designs.design_order_id is ON DELETE
// CASCADE — a naive age-based delete would silently destroy customers' saved
// work (the row goes, the library entry cascades away, no error, no trace).
// So the delete set is: drafts older than DRAFT_MAX_AGE_DAYS that NO
// saved_designs row references. The exclusion is computed as an explicit
// anti-join and reported in the output so every run shows how many rows it
// protected. (Mirrors the SQL in CLAUDE.md's cron warning.)
//
// Runs on Vercel Cron. Auth: Authorization: Bearer CRON_SECRET (fails closed
// when unset). ?dry_run=1 reports without deleting.

const DRAFT_MAX_AGE_DAYS = 7
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
  const cutoff = new Date(Date.now() - DRAFT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const supabase = serviceClient()

  // 1. Candidates: old drafts. (status='draft' exactly — 'ordering' /
  // 'cart_created' rows may still be racing a webhook and age out only after
  // their Shopify product does, via the retention job's expiry gate + a
  // future pass; deleting them here could strand a paid order's webhook.)
  const { data: candidates, error: candErr } = await supabase
    .from('design_orders')
    .select('id, created_at, product_title')
    .eq('status', 'draft')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(500)
  if (candErr) {
    console.error('[drafts] candidate query failed:', candErr)
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 })
  }

  // 2. The exclusion: which of these are saved designs?
  const candidateIds = (candidates ?? []).map((c) => c.id)
  let savedIds = new Set<string>()
  if (candidateIds.length > 0) {
    const { data: saved, error: savedErr } = await supabase
      .from('saved_designs')
      .select('design_order_id')
      .in('design_order_id', candidateIds)
    if (savedErr) {
      // Fail CLOSED: if we can't prove a draft isn't saved, nothing deletes.
      console.error('[drafts] saved_designs exclusion query failed — aborting:', savedErr)
      return NextResponse.json({ error: 'Exclusion query failed — no deletions' }, { status: 500 })
    }
    savedIds = new Set((saved ?? []).map((s) => s.design_order_id))
  }

  const deletable = candidateIds.filter((id) => !savedIds.has(id)).slice(0, MAX_DELETES_PER_RUN)

  // 3. Delete in chunks (unless dry run).
  let deleted = 0
  if (!dryRun && deletable.length > 0) {
    for (let i = 0; i < deletable.length; i += 100) {
      const chunk = deletable.slice(i, i + 100)
      const { error: delErr } = await supabase
        .from('design_orders')
        .delete()
        .in('id', chunk)
        // Belt and suspenders: re-assert draft status at delete time so a row
        // that progressed (e.g. got ordered mid-run) survives.
        .eq('status', 'draft')
      if (delErr) {
        console.error('[drafts] delete chunk failed:', delErr)
        return NextResponse.json(
          { error: 'Delete failed partway', deleted },
          { status: 500 }
        )
      }
      deleted += chunk.length
    }
  }

  const summary = {
    dryRun,
    cutoff,
    candidates: candidateIds.length,
    protectedBySavedDesigns: savedIds.size,
    deleted: dryRun ? 0 : deleted,
    wouldDelete: dryRun ? deletable.length : undefined,
    deferredByCap: Math.max(0, candidateIds.length - savedIds.size - MAX_DELETES_PER_RUN),
  }
  console.log(`[drafts]${dryRun ? ' (dry)' : ''}`, JSON.stringify(summary))
  return NextResponse.json(summary)
}
