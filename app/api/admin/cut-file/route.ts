// Admin-only, on-demand cut-file generation (Phase 5, Stage 1b proof).
// GET /api/admin/cut-file?order=<uuid>&side=front[&font=Impact]
// Streams ONE outlined, physically-sized, Illustrator-clean SVG for the first live text
// object on that side. Stage-1b scope: local fonts (Impact default), templated orders,
// uncurved single text — everything else returns a clear 422.
import { NextRequest, NextResponse } from 'next/server'
import * as opentype from 'opentype.js'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'
import { getFontBuffer, toArrayBuffer, baseFamily } from '../../../lib/server/fontBuffer'
import { boxFromSnapshot, isSnapshot } from '../../../lib/server/cutFileGeometry'
import { outlineText, assembleCutSvg, type TextPlacement, type CutPath } from '../../../lib/server/cutFileEngine'

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

  // 3. every live text object (Fabric 7 serializes type PascalCase — "IText"/"Textbox";
  //    match case-insensitively, verified against a live order). Curved text (a baked
  //    Image with _isCurvedText) is a Stage-2c step — skipped here, not matched by the
  //    text filter anyway.
  let parsed: { objects?: Array<Record<string, unknown>> }
  try { parsed = JSON.parse(canvasJson) } catch { return NextResponse.json({ error: 'bad canvas json' }, { status: 500 }) }
  const TEXT_TYPES = ['itext', 'i-text', 'textbox', 'text']
  const textObjs = (parsed.objects ?? []).filter(x =>
    TEXT_TYPES.includes(String(x.type).toLowerCase()) && !x._isCurvedText)
  if (textObjs.length === 0) return NextResponse.json({ error: 'no (uncurved) text on this side' }, { status: 422 })

  // 4. outline EACH text object in its OWN font; group by color into layers downstream.
  const canvasBox = boxFromSnapshot(snap)
  const phys = { width_in: snap.width_in, height_in: snap.height_in }
  const fontCache = new Map<string, opentype.Font>()
  const failures = new Set<string>()
  const paths: CutPath[] = []
  for (const t of textObjs) {
    const family = baseFamily(fontOverride ?? String(t.fontFamily ?? 'Impact'))
    let font = fontCache.get(family)
    if (!font) {
      try {
        const f = opentype.parse(toArrayBuffer(await getFontBuffer(family)))
        if (!f.supported) throw new Error('unsupported by opentype')
        font = f; fontCache.set(family, f)
      } catch (e) { failures.add(`${family} — ${(e as Error).message}`); continue }
    }
    const place: TextPlacement = {
      text: String(t.text ?? ''), fontSizePx: Number(t.fontSize ?? 40),
      scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1),
      left: Number(t.left), top: Number(t.top), angle: Number(t.angle ?? 0),
      fill: typeof t.fill === 'string' ? t.fill : '#000000',
      textAlign: (t.textAlign === 'left' || t.textAlign === 'right') ? t.textAlign : 'center',
      charSpacing: Number(t.charSpacing ?? 0),
    }
    paths.push(outlineText(font, place, canvasBox, phys))
  }

  // Never silently drop a word we couldn't outline — fail loud with the font list so a
  // partial file can't be mistaken for complete (Rockwell .ttc is the known local case).
  if (failures.size) {
    return NextResponse.json(
      { error: 'Some fonts could not be outlined (nothing generated, to avoid a partial file)', fonts: [...failures] },
      { status: 422 },
    )
  }
  if (paths.length === 0) return NextResponse.json({ error: 'nothing to outline' }, { status: 422 })

  const svg = assembleCutSvg(paths, phys)

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="cut-${orderId.slice(0, 8)}-${side}.svg"`,
      'Cache-Control': 'no-store',
    },
  })
}
