// Admin-only, on-demand PRODUCTION BUNDLE for one order (Phase 5, Stage 3).
// GET /api/admin/production-bundle?order=<uuid>
// Streams a ZIP with everything the print shop needs for one order: the outlined vector cut
// file per designed side (generated fresh via the shared core), the customer's placed uploads
// (display renditions + untouched originals), and a MANIFEST.txt. NOTHING is stored — the cut
// files are reproduced from the frozen order data and the uploads are pulled from where they
// already live, so the bundle is always reproducible and there is no storage/idempotency/GC to
// manage. Any side that can't be generated is named LOUDLY in the manifest, never dropped silently.
import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'
import { generateCutSvgForSide } from '../../../lib/server/generateCutFile'

export const runtime = 'nodejs' // opentype.js + local-font fs read (see next.config trace-includes)

const allowed = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

type UploadedFile = { name?: string; url?: string; type?: string; originalUrl?: string; originalFormat?: string }

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch { return null }
}

export async function GET(req: NextRequest) {
  // admin gate (same Supabase cookie session as /admin and the cut-file route)
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email || !allowed().includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orderId = new URL(req.url).searchParams.get('order') || ''
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: 'bad order id' }, { status: 400 })

  // load via SERVICE ROLE (admin already authed; covers completed/PII rows)
  const { data: o, error } = await serviceClient()
    .from('design_orders')
    .select('canvas_json_front,canvas_json_back,print_area_front,print_area_back,uploaded_files,shopify_order_number,product_title,selected_color')
    .eq('id', orderId).maybeSingle()
  if (error || !o) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const orderNo = o.shopify_order_number ? String(o.shopify_order_number) : orderId.slice(0, 8)
  const stem = `order-${orderNo}`
  const zip = new JSZip()
  const folder = zip.folder(stem)!
  const manifest: string[] = [
    `Production bundle — ${stem}`,
    o.product_title ? `Product: ${o.product_title}${o.selected_color ? ` (${o.selected_color})` : ''}` : '',
    `Generated on download — files are reproduced fresh from the order, nothing is cached.`,
    ``,
    `CUT FILES (vector — outlined glyph/clipart paths, true physical size, colors as named layers):`,
  ].filter(Boolean)

  // 1. cut file per designed side
  for (const side of ['front', 'back'] as const) {
    const canvasJson = side === 'front' ? o.canvas_json_front : o.canvas_json_back
    const snap = side === 'front' ? o.print_area_front : o.print_area_back
    const r = await generateCutSvgForSide(canvasJson, snap)
    if (r.ok) {
      folder.file(`${orderNo}-${side}.svg`, r.svg)
      manifest.push(`  ✓ ${orderNo}-${side}.svg`)
    } else if (r.reason === 'outline-failed' || r.reason === 'bad-json') {
      // a real problem — a human needs to see this
      manifest.push(`  ⚠ COULD NOT GENERATE ${side}: ${r.message}${r.fonts ? ` [${r.fonts.join('; ')}]` : ''}`)
    } else {
      // no-design / no-print-area / no-vector are legitimate "nothing to cut on this side"
      manifest.push(`  — ${side}: ${r.message}`)
    }
  }

  // 2. placed uploads — display rendition (the print raster for photos) + untouched original
  const uploads = Array.isArray(o.uploaded_files) ? (o.uploaded_files as UploadedFile[]) : []
  manifest.push(``, `UPLOADED ARTWORK (${uploads.length} placed file${uploads.length === 1 ? '' : 's'}):`)
  if (uploads.length === 0) manifest.push(`  (none)`)
  const upFolder = uploads.length ? folder.folder('uploads')! : null
  for (let i = 0; i < uploads.length; i++) {
    const f = uploads[i]
    const base = (f.name || `upload-${i + 1}`).replace(/[/\\]/g, '_')
    if (f.url) {
      const bytes = await fetchBytes(f.url)
      if (bytes) { upFolder!.file(`${i + 1}-${base}`, bytes); manifest.push(`  ✓ uploads/${i + 1}-${base}`) }
      else manifest.push(`  ⚠ uploads/${i + 1}-${base} — could not fetch`)
    }
    if (f.originalUrl) {
      const ext = f.originalFormat ? `.${f.originalFormat.replace(/^\./, '')}` : ''
      const oname = `${i + 1}-${base}-original${ext}`
      const bytes = await fetchBytes(f.originalUrl)
      if (bytes) { upFolder!.folder('originals')!.file(oname, bytes); manifest.push(`  ✓ uploads/originals/${oname}`) }
      else manifest.push(`  ⚠ uploads/originals/${oname} — could not fetch`)
    }
  }

  folder.file('MANIFEST.txt', manifest.join('\n') + '\n')

  const body = await zip.generateAsync({ type: 'arraybuffer' }) // plain ArrayBuffer = clean BodyInit
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${stem}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}
