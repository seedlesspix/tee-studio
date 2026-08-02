// Admin-only, on-demand cut-file generation (Phase 5, Stage 1b proof).
// GET /api/admin/cut-file?order=<uuid>&side=front[&font=Impact]
// Streams ONE outlined, physically-sized, Illustrator-clean SVG for the first live text
// object on that side. Stage-1b scope: local fonts (Impact default), templated orders,
// uncurved single text — everything else returns a clear 422.
import { NextRequest, NextResponse } from 'next/server'
import * as opentype from 'opentype.js'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'
import { getFontBuffer, toArrayBuffer } from '../../../lib/server/fontBuffer'
import { boxFromSnapshot, isSnapshot } from '../../../lib/server/cutFileGeometry'
import { buildTextCutSvg, type TextPlacement } from '../../../lib/server/cutFileEngine'

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
  const family = u.searchParams.get('font') || 'Impact' // Stage 1b: Impact first
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
  if (!canvasJson) return NextResponse.json({ error: `no ${side} design` }, { status: 422 })
  if (!isSnapshot(snap)) return NextResponse.json({ error: 'no physical print area (non-templated order?)' }, { status: 422 })

  // 3. first live text object; reject Stage-1b non-goals with a clear message
  let parsed: { objects?: Array<Record<string, unknown>> }
  try { parsed = JSON.parse(canvasJson) } catch { return NextResponse.json({ error: 'bad canvas json' }, { status: 500 }) }
  const t = (parsed.objects ?? []).find(x => ['i-text', 'textbox', 'text'].includes(String(x.type)))
  if (!t) return NextResponse.json({ error: 'no text object on this side' }, { status: 422 })
  if (t._isCurvedText) return NextResponse.json({ error: 'curved text not supported yet (Stage 1b)' }, { status: 422 })

  const place: TextPlacement = {
    text: String(t.text ?? ''), fontSizePx: Number(t.fontSize ?? 40),
    scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1),
    left: Number(t.left), top: Number(t.top), angle: Number(t.angle ?? 0),
    fill: typeof t.fill === 'string' ? t.fill : '#000000',
    textAlign: (t.textAlign === 'left' || t.textAlign === 'right') ? t.textAlign : 'center',
    charSpacing: Number(t.charSpacing ?? 0),
  }

  // 4. load font + emit
  let font: opentype.Font
  try { font = opentype.parse(toArrayBuffer(await getFontBuffer(family))) }
  catch (e) { return NextResponse.json({ error: `font load failed: ${(e as Error).message}` }, { status: 500 }) }
  if (!font.supported) return NextResponse.json({ error: 'font unsupported' }, { status: 500 })

  const svg = buildTextCutSvg(
    font, place, boxFromSnapshot(snap),
    { width_in: snap.width_in, height_in: snap.height_in },
    { layerName: place.fill },
  )

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="cut-${orderId.slice(0, 8)}-${side}.svg"`,
      'Cache-Control': 'no-store',
    },
  })
}
