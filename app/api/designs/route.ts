import { NextRequest, NextResponse } from 'next/server'
import {
  serviceClient,
  getCustomerId,
  getSessionId,
  getOrCreateSessionId,
  setSessionCookie,
  UUID_RE,
} from '../../lib/customer-library'
import { designStateToRow, type DesignState } from '../../lib/design-state'

// Node runtime for crypto.randomUUID() + jose (ID-token verify).
export const runtime = 'nodejs'

// "My Designs" — the customer's saved-design library.
//
// saved_designs is an INDEX of design_orders rows the customer chose to keep.
// Ownership lives on saved_designs (NOT design_orders, which carries a blanket
// anon read policy — see BLOCKER-1 in BUILD_PLAN.md), and the table has RLS on
// with no policies, so every read/write flows through the service role here with
// the owner derived server-side. The browser never names an owner.

const MAX_NAME = 80
// Canvas JSON embeds uploaded images as data URLs, so a save can be a few MB.
const MAX_BYTES = 12 * 1024 * 1024

type SavedRow = {
  id: string
  name: string | null
  updated_at: string
  design_order_id: string
  design_orders:
    | {
        canvas_png_front: string | null
        product_title: string | null
        selected_color: string | null
        shopify_product_id: string | null
      }
    | Array<{
        canvas_png_front: string | null
        product_title: string | null
        selected_color: string | null
        shopify_product_id: string | null
      }>
    | null
}

// The designer's URL param is the BARE numeric product id, while design_orders
// stores the GID — strip it so the drawer can build a working restore link.
function numericProductId(gid: string | null): string | null {
  if (!gid) return null
  const m = gid.match(/(\d+)\s*$/)
  return m ? m[1] : null
}

function toDTO(r: SavedRow) {
  const d = Array.isArray(r.design_orders) ? r.design_orders[0] : r.design_orders
  return {
    savedId: r.id,
    designId: r.design_order_id,
    name: r.name,
    updatedAt: r.updated_at,
    thumbnailUrl: d?.canvas_png_front ?? null,
    productTitle: d?.product_title ?? null,
    color: d?.selected_color ?? null,
    productId: numericProductId(d?.shopify_product_id ?? null),
  }
}

const SELECT =
  'id, name, updated_at, design_order_id, design_orders(canvas_png_front, product_title, selected_color, shopify_product_id)'

// GET — list the caller's saved designs, most recently updated first.
export async function GET(request: NextRequest) {
  const customerId = await getCustomerId(request)
  const sessionId = getSessionId(request)

  // Non-null owner guard: with no owner, return empty rather than query. Every
  // query below filters by equality to a concrete non-null owner, so it can
  // never match a row whose owner column is null.
  if (!customerId && !sessionId) return NextResponse.json({ designs: [] })

  const supabase = serviceClient()
  let query = supabase
    .from('saved_designs')
    .select(SELECT)
    .order('updated_at', { ascending: false })
    .limit(100)
  query = customerId
    ? query.eq('shopify_customer_id', customerId)
    : query.eq('session_id', sessionId!)

  const { data, error } = await query
  if (error) {
    console.error('[designs] list failed:', error)
    return NextResponse.json({ error: 'Could not load designs' }, { status: 500 })
  }
  return NextResponse.json({ designs: (data as unknown as SavedRow[]).map(toDTO) })
}

// POST — save the current canvas to the library.
//   { designId?, name?, state, pngFront? }
//
// If the caller already OWNS a library entry for designId, that design is
// updated in place (so its restore link keeps working). Otherwise a brand-new
// design row is created — which means saving a design you don't own (e.g. one
// opened from someone else's shared link) forks your own copy rather than
// overwriting theirs. A client-supplied designId is therefore never trusted for
// an update; ownership is checked first.
export async function POST(request: NextRequest) {
  let body: { designId?: unknown; name?: unknown; state?: DesignState; pngFront?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const state = body.state
  if (!state || typeof state !== 'object') {
    return NextResponse.json({ error: 'Missing design state' }, { status: 400 })
  }
  if (JSON.stringify(body).length > MAX_BYTES) {
    return NextResponse.json({ error: 'Design too large' }, { status: 413 })
  }

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, MAX_NAME)
    : null
  const pngFront = typeof body.pngFront === 'string' ? body.pngFront : null

  const customerId = await getCustomerId(request)
  let sessionId: string | null = null
  let mintedSession = false
  if (!customerId) {
    // Get-or-create: a customer may save a design without ever having uploaded,
    // so this path must be able to mint the session cookie too.
    const session = getOrCreateSessionId(request)
    sessionId = session.sessionId
    mintedSession = session.isNew
  }

  const supabase = serviceClient()
  const requestedId = typeof body.designId === 'string' && UUID_RE.test(body.designId)
    ? body.designId
    : null

  // Only update a design the caller demonstrably owns.
  let owned: { id: string } | null = null
  if (requestedId) {
    let q = supabase.from('saved_designs').select('id').eq('design_order_id', requestedId)
    q = customerId ? q.eq('shopify_customer_id', customerId) : q.eq('session_id', sessionId!)
    const { data } = await q.maybeSingle()
    owned = data ?? null
  }

  const rowFromState = {
    ...designStateToRow(state),
    ...(pngFront ? { canvas_png_front: pngFront } : {}),
  }

  if (owned && requestedId) {
    const updated = await supabase
      .from('design_orders')
      .update(rowFromState)
      .eq('id', requestedId)
    if (updated.error) {
      console.error('[designs] design update failed:', updated.error)
      return NextResponse.json({ error: 'Could not save design' }, { status: 500 })
    }
    // Touch the library entry (the set_updated_at trigger bumps updated_at).
    const touched = await supabase
      .from('saved_designs')
      .update({ name })
      .eq('id', owned.id)
    if (touched.error) {
      console.error('[designs] library update failed:', touched.error)
      return NextResponse.json({ error: 'Could not save design' }, { status: 500 })
    }
    const response = NextResponse.json({ designId: requestedId, savedId: owned.id, created: false })
    if (mintedSession && sessionId) setSessionCookie(response, sessionId)
    return response
  }

  // Create a fresh design + library entry.
  const designId = crypto.randomUUID()
  const inserted = await supabase.from('design_orders').insert({
    id: designId,
    status: 'draft',
    created_at: new Date().toISOString(),
    ...rowFromState,
  })
  if (inserted.error) {
    console.error('[designs] design insert failed:', inserted.error)
    return NextResponse.json({ error: 'Could not save design' }, { status: 500 })
  }

  const { data: saved, error: savedError } = await supabase
    .from('saved_designs')
    .insert({
      design_order_id: designId,
      shopify_customer_id: customerId,
      session_id: customerId ? null : sessionId,
      name,
    })
    .select('id')
    .single()
  if (savedError) {
    console.error('[designs] library insert failed:', savedError)
    return NextResponse.json({ error: 'Could not save design' }, { status: 500 })
  }

  const response = NextResponse.json({ designId, savedId: saved.id, created: true })
  if (mintedSession && sessionId) setSessionCookie(response, sessionId)
  return response
}

// DELETE ?id=<savedId> — remove the library entry, scoped to the caller.
// Leaves the design_orders row intact: any restore link the customer already
// shared keeps working, and nothing referencing the design breaks.
export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const customerId = await getCustomerId(request)
  const sessionId = getSessionId(request)
  if (!customerId && !sessionId) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const supabase = serviceClient()
  let query = supabase.from('saved_designs').delete().eq('id', id)
  query = customerId
    ? query.eq('shopify_customer_id', customerId)
    : query.eq('session_id', sessionId!)

  const { error } = await query
  if (error) {
    console.error('[designs] delete failed:', error)
    return NextResponse.json({ error: 'Could not remove design' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
