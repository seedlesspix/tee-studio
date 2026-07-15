import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import {
  DESIGN_STATE_COLUMNS,
  designStateToRow,
  rowToDesignState,
  type DesignState,
  type DesignStateRow,
} from '../../../lib/design-state'

// Node runtime for crypto.randomUUID(), matching the other new route handlers.
export const runtime = 'nodejs'

// Anonymous design drafts.
//
// POST /api/designs/draft
//   Body: the designer's snapshot (see DraftState). Writes a design_orders row
//   with status='draft' (customer not logged in yet — no PII, no customer id)
//   and returns { draftId }. Used to survive the Shopify OAuth round-trip: the
//   button POSTs here, then redirects to login with return_to pointing back at
//   /designer?...&restore=<draftId>.
//
// GET /api/designs/draft?id=<uuid>
//   Returns { state } — the snapshot reconstructed from the row — so the
//   designer can rehydrate the canvas on return.
//
// A draft is deliberately a normal design_orders row (status='draft' is the
// same value saveDesignAndAddToCart uses), so no schema change is needed and
// a future nightly cleanup can find abandoned drafts by
// status='draft' AND created_at < now() - interval '7 days' (Phase 4).
//
// RLS: design_orders allows public insert/read of non-completed rows, so the
// anon server client is sufficient — drafts carry no PII.

// The snapshot shape + its row mapping are shared with /api/designs (My
// Designs) via lib/design-state, so adding a column updates both paths at once.
type DraftState = DesignState

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Canvas JSON embeds uploaded images as data URLs, so drafts can be a few MB
// (the whole reason we persist to the DB instead of sessionStorage). Cap it
// so a malformed or malicious payload can't try to write an enormous row.
const MAX_BYTES = 12 * 1024 * 1024

export async function POST(request: NextRequest) {
  let body: DraftState
  try {
    body = (await request.json()) as DraftState
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid draft payload' }, { status: 400 })
  }

  const serialized = JSON.stringify(body)
  if (serialized.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Draft too large' }, { status: 413 })
  }

  const id = crypto.randomUUID()
  const supabase = await createClient()

  const { error } = await supabase.from('design_orders').insert({
    id,
    status: 'draft',
    // Explicit so a future cleanup job can reliably age out abandoned drafts
    // even if the column's server-side default ever changes.
    created_at: new Date().toISOString(),
    ...designStateToRow(body),
  })

  if (error) {
    console.error('[designs/draft] insert failed:', error)
    return NextResponse.json({ error: 'Could not save draft' }, { status: 500 })
  }

  return NextResponse.json({ draftId: id })
}

export async function GET(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid draft id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('design_orders')
    .select(DESIGN_STATE_COLUMNS)
    .eq('id', id)
    // Only ever serve drafts — never a real (submitted/completed) order.
    .eq('status', 'draft')
    .maybeSingle()

  if (error) {
    console.error('[designs/draft] fetch failed:', error)
    return NextResponse.json({ error: 'Could not load draft' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  const state: DraftState = rowToDesignState(data as unknown as DesignStateRow)
  return NextResponse.json({ state })
}
