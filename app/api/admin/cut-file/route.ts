// Admin-only, on-demand cut-file generation (Phase 5, Stage 1b proof).
// GET /api/admin/cut-file?order=<uuid>&side=front[&font=Impact]
// Streams ONE outlined, physically-sized, Illustrator-clean SVG for the first live text
// object on that side. Stage-1b scope: local fonts (Impact default), templated orders,
// uncurved single text — everything else returns a clear 422.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'
import { generateCutSvgForSide } from '../../../lib/server/generateCutFile'

export const runtime = 'nodejs' // trace-includes + fs don't exist on edge

const allowed = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

export async function GET(req: NextRequest) {
  // 1. admin gate (same Supabase cookie session as /admin)
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email || !allowed().includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const u = new URL(req.url)
  const orderId = u.searchParams.get('order') || ''
  const side = (u.searchParams.get('side') || 'front') as 'front' | 'back'
  const fontOverride = u.searchParams.get('font') // optional: force one font for testing
  const mirror = u.searchParams.get('mirror') === '1' // optional: flip for heat-transfer vinyl
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: 'bad order id' }, { status: 400 })
  if (side !== 'front' && side !== 'back') return NextResponse.json({ error: 'bad side' }, { status: 400 })

  // 2. load the order via SERVICE ROLE (admin already authed; covers completed/PII rows)
  const { data: o, error } = await serviceClient()
    .from('design_orders')
    .select('canvas_json_front,canvas_json_back,print_area_front,print_area_back')
    .eq('id', orderId).maybeSingle()
  if (error || !o) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const canvasJson = side === 'front' ? o.canvas_json_front : o.canvas_json_back
  const snap = side === 'front' ? o.print_area_front : o.print_area_back

  // 3. generate via the shared core (identical to the whole-order bundle route). Loud-fail
  //    is preserved: any un-outlinable object returns a typed failure, never a partial file.
  const result = await generateCutSvgForSide(canvasJson, snap, { fontOverride, mirror })
  if (!result.ok) {
    return NextResponse.json({ error: result.message, ...(result.fonts ? { fonts: result.fonts } : {}) }, { status: 422 })
  }
  const svg = result.svg

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="cut-${orderId.slice(0, 8)}-${side}${mirror ? '-mirrored' : ''}.svg"`,
      'Cache-Control': 'no-store',
    },
  })
}
