// Admin-only, on-demand PRODUCTION BUNDLE for one order (Phase 5, Stage 3).
// GET /api/admin/production-bundle?order=<uuid>
// Streams a ZIP shaped for the fulfillment bench — folder names say what things are FOR:
//   order-<number>/
//     OrderInfo.txt   customer, order #, ship/pickup, sizes/qty, garment, per-side design summary,
//                     and LOUD ⚠ flags for any side that couldn't generate
//     Cut Files/      outlined vector cut file per designed side (true size, colors as layers)
//     Previews/       the shirt mockup the customer approved (bench visual check)
//     Originals/      best print source per upload (raw original, or the photo itself)
//     Uploads/        web-converted placed versions (reference only; present only for converted files)
// NOTHING is stored — cut files are reproduced from the frozen order data and everything else is
// pulled from where it already lives, so the bundle is always reproducible (no storage/idempotency/GC).
import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import sharp from 'sharp'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'
import { collectCutPaths } from '../../../lib/server/generateCutFile'
import { assembleCutSvgUnioned } from '../../../lib/server/cutBoolean'
import { generateLayoutSvgForSide } from '../../../lib/server/generateLayout'

export const runtime = 'nodejs' // opentype.js + local-font fs read (see next.config trace-includes)

const allowed = () =>
  (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

type UploadedFile = { name?: string; url?: string; type?: string; originalUrl?: string; originalFormat?: string; edited?: boolean }

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch { return null }
}

// White/near-white artwork can't be live-traced (a tracer needs dark-on-light). Detect it so the
// bundle can auto-include an inverted copy — killing the shop's manual Photoshop-invert round-trip.
async function isLightArtwork(bytes: Uint8Array): Promise<boolean> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes)).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let opaque = 0, light = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3] < 128) continue // ignore transparent pixels — judge the artwork itself
      opaque++
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > 200) light++
    }
    return opaque > 0 && light / opaque > 0.6
  } catch { return false }
}

// Invert RGB, keep alpha -> a tracer-friendly dark-on-transparent copy.
async function invertPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try { return new Uint8Array(await sharp(Buffer.from(bytes)).ensureAlpha().negate({ alpha: false }).png().toBuffer()) }
  catch { return null }
}

const val = (v: unknown) => (v == null || v === '' ? '—' : String(v))

// Per-side design summary from the frozen Fabric JSON: object counts + ink/vinyl colors used.
function summarizeSide(json: string | null | undefined): string {
  if (!json) return '(no design)'
  let objs: Array<Record<string, unknown>> = []
  try { objs = (JSON.parse(json).objects ?? []) as Array<Record<string, unknown>> } catch { return '(unreadable)' }
  const TEXT = ['itext', 'i-text', 'textbox', 'text']
  let text = 0, curved = 0, clipart = 0, photo = 0
  const colors = new Set<string>()
  for (const o of objs) {
    const type = String(o.type).toLowerCase()
    if (o._isCurvedText === true) { curved++; if (typeof o._curveFill === 'string') colors.add(o._curveFill) }
    else if (TEXT.includes(type)) { text++; if (typeof o.fill === 'string') colors.add(o.fill) }
    else if (type === 'image' && o._isSvg === true) { clipart++; if (typeof o._currentColor === 'string') colors.add(o._currentColor) }
    else if (type === 'image') { photo++ }
  }
  const parts: string[] = []
  if (text) parts.push(`${text} text`)
  if (curved) parts.push(`${curved} curved text`)
  if (clipart) parts.push(`${clipart} clipart`)
  if (photo) parts.push(`${photo} photo${photo > 1 ? 's' : ''}`)
  if (!parts.length) return '(no design elements)'
  let s = parts.join(', ')
  if (colors.size) s += ` · colors: ${[...colors].join(', ')}`
  return s
}

function formatAddress(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null
  const x = a as Record<string, unknown>
  const name = [x.first_name, x.last_name].filter(Boolean).join(' ') || (x.name as string) || ''
  const cityLine = [x.city, x.province_code || x.province, x.zip].filter(Boolean).join(', ')
  const lines = [name, x.company, x.address1, x.address2, cityLine, x.country].filter(Boolean) as string[]
  return lines.length ? lines.join('\n           ') : null // indent continuation lines under "Address: "
}

function formatQuantities(q: unknown, order: unknown): { lines: string[]; total: number } {
  if (!q || typeof q !== 'object') return { lines: ['  (none)'], total: 0 }
  const qmap = q as Record<string, unknown>
  const sizes = Array.isArray(order) && order.length ? (order as string[]) : Object.keys(qmap)
  const lines: string[] = []
  let total = 0
  for (const s of sizes) {
    const n = Number(qmap[s] ?? 0)
    if (n > 0) { lines.push(`  ${s} × ${n}`); total += n }
  }
  return lines.length ? { lines, total } : { lines: ['  (none)'], total: 0 }
}

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email || !allowed().includes(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orderId = new URL(req.url).searchParams.get('order') || ''
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: 'bad order id' }, { status: 400 })

  const { data: o, error } = await serviceClient()
    .from('design_orders')
    .select([
      'canvas_json_front', 'canvas_json_back', 'print_area_front', 'print_area_back',
      'canvas_png_front', 'canvas_png_back', 'uploaded_files', 'shopify_order_number',
      'product_title', 'selected_color', 'selected_color_hex', 'print_method', 'sides_designed',
      'status', 'customer_name', 'customer_email', 'customer_phone', 'shipping_address',
      'shipping_lines', 'quantities', 'available_sizes',
    ].join(','))
    .eq('id', orderId).maybeSingle() as { data: Record<string, unknown> | null; error: unknown }
  if (error || !o) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const orderNo = o.shopify_order_number ? String(o.shopify_order_number) : orderId.slice(0, 8)
  const stem = `order-${orderNo}`
  const zip = new JSZip()
  const root = zip.folder(stem)!

  // ---- Cut Files/ (normal) + Cut Files (Mirrored)/ — BOTH orientations, zero prep at the
  //      bench. Each cut file is union'd per color + math-cropped (no clip mask); the mirrored
  //      copy is flipped for heat-transfer vinyl. Outline ONCE, assemble twice. ----
  const cutFolder = root.folder('Cut Files')!
  const cutMirrorFolder = root.folder('Cut Files (Mirrored)')!
  const cutLines: string[] = []
  for (const side of ['front', 'back'] as const) {
    const canvasJson = side === 'front' ? o.canvas_json_front : o.canvas_json_back
    const snap = side === 'front' ? o.print_area_front : o.print_area_back
    const c = await collectCutPaths(canvasJson as string | null, snap)
    if (c.ok) {
      cutFolder.file(`${orderNo}-${side}.svg`, assembleCutSvgUnioned(c.paths, c.phys, { mirror: false }))
      cutMirrorFolder.file(`${orderNo}-${side}.svg`, assembleCutSvgUnioned(c.paths, c.phys, { mirror: true }))
      cutLines.push(`  ✓ ${orderNo}-${side}.svg  (normal + mirrored)`)
    } else if (c.reason === 'outline-failed' || c.reason === 'bad-json') {
      cutLines.push(`  ⚠ COULD NOT GENERATE ${side}: ${c.message}${c.fonts ? ` [${c.fonts.join('; ')}]` : ''}`)
    } else {
      cutLines.push(`  — ${side}: ${c.message}`)
    }
  }

  // ---- Layout/ (placement sheet — EVERY element at true size/position, incl. rasters) ----
  const layoutFolder = root.folder('Layout')!
  const layoutLines: string[] = []
  for (const side of ['front', 'back'] as const) {
    const canvasJson = side === 'front' ? o.canvas_json_front : o.canvas_json_back
    const snap = side === 'front' ? o.print_area_front : o.print_area_back
    const r = await generateLayoutSvgForSide(canvasJson as string | null, snap)
    if (r.ok) {
      layoutFolder.file(`${orderNo}-${side}-layout.svg`, r.svg)
      layoutLines.push(`  ✓ Layout/${orderNo}-${side}-layout.svg`)
      for (const f of r.failures) layoutLines.push(`    ⚠ ${side}: ${f}`)
    } else if (r.reason === 'bad-json' || r.reason === 'empty') {
      layoutLines.push(`  ⚠ ${side} layout: ${r.message}`)
    } else {
      layoutLines.push(`  — ${side}: ${r.message}`)
    }
  }

  // ---- Previews/ (the shirt mockups the customer saw) ----
  const previewsFolder = root.folder('Previews')!
  const previewLines: string[] = []
  for (const side of ['front', 'back'] as const) {
    const url = (side === 'front' ? o.canvas_png_front : o.canvas_png_back) as string | null
    if (!url) continue
    const bytes = await fetchBytes(url)
    if (bytes) { previewsFolder.file(`${orderNo}-${side}-preview.png`, bytes); previewLines.push(`  ✓ Previews/${orderNo}-${side}-preview.png`) }
    else previewLines.push(`  ⚠ Previews/${orderNo}-${side}-preview.png — could not fetch`)
  }
  if (!previewLines.length) previewLines.push('  (none)')

  // ---- Originals/ (best print source per upload) + Uploads/ (reference web renditions) ----
  const uploads = Array.isArray(o.uploaded_files) ? (o.uploaded_files as UploadedFile[]) : []
  const origFolder = uploads.length ? root.folder('Originals')! : null
  const origLines: string[] = []
  const uploadLines: string[] = []
  let webFolder: JSZip | null = null
  for (let i = 0; i < uploads.length; i++) {
    const f = uploads[i]
    const base = (f.name || `upload-${i + 1}`).replace(/[/\\]/g, '_')
    const stem = base.replace(/\.[^.]+$/, '')
    const isEdited = f.edited === true
    // Best print source: an EDITED upload prints from the REVISED (background/color-removed)
    // image; a converted file prints from the raw vector; a plain photo prints from itself.
    const printUrl = isEdited ? (f.url || f.originalUrl) : (f.originalUrl || f.url)
    if (printUrl) {
      const name = isEdited ? `${i + 1}-${stem}-edited.png` : `${i + 1}-${base}`
      const bytes = await fetchBytes(printUrl)
      if (bytes) {
        origFolder!.file(name, bytes)
        origLines.push(`  ✓ Originals/${name}${isEdited ? '  (background/color removed — cut/print from this)' : ''}`)
        // Auto-invert white/light artwork so the shop skips the manual Photoshop-invert before tracing.
        if (await isLightArtwork(bytes)) {
          const inv = await invertPng(bytes)
          if (inv) {
            origFolder!.file(`${i + 1}-${stem}-inverted.png`, inv)
            origLines.push(`  ✓ Originals/${i + 1}-${stem}-inverted.png  (auto-inverted — white/light artwork, for tracing)`)
          }
        }
      } else origLines.push(`  ⚠ Originals/${name} — could not fetch`)
    }
    // Reference copy in Uploads/: an EDITED upload keeps the pristine pre-edit raw; a converted
    // file keeps its web PNG rendition. Plain photos have no reference copy (they ARE the source).
    const refUrl = isEdited ? (f.originalUrl && f.originalUrl !== f.url ? f.originalUrl : null)
                            : (f.originalUrl && f.url ? f.url : null)
    if (refUrl) {
      webFolder ??= root.folder('Uploads')!
      const wname = isEdited ? `${i + 1}-${stem}-before-edit.${f.originalFormat || 'png'}` : `${i + 1}-${stem}-web.png`
      const bytes = await fetchBytes(refUrl)
      if (bytes) { webFolder.file(wname, bytes); uploadLines.push(`  ✓ Uploads/${wname}`) }
      else uploadLines.push(`  ⚠ Uploads/${wname} — could not fetch`)
    }
  }
  if (!origLines.length) origLines.push('  (none)')
  if (!uploadLines.length) uploadLines.push('  (none — every upload is already the best source in Originals/)')

  // ---- OrderInfo.txt ----
  const paid = o.status === 'completed'
  const notYet = paid ? '—' : '— (captured when the order is paid)'
  const qty = formatQuantities(o.quantities, o.available_sizes)
  const addr = formatAddress(o.shipping_address)
  const shipTitle = Array.isArray(o.shipping_lines)
    ? (o.shipping_lines as Array<Record<string, unknown>>).map(l => l?.title).filter(Boolean).join(', ')
    : ''
  const method = shipTitle || (addr ? 'Ship' : notYet)
  const printLabel = o.print_method === 'screen_print' ? 'Print' : val(o.print_method).replace(/_/g, ' ')

  const info: string[] = [
    `ORDER ${orderNo}${paid ? '' : `   [${String(o.status || 'draft').toUpperCase()} — not a paid order yet]`}`,
    `${'='.repeat(50)}`,
    ``,
    `CUSTOMER`,
    `  Name:    ${paid ? val(o.customer_name) : notYet}`,
    `  Email:   ${paid ? val(o.customer_email) : notYet}`,
    `  Phone:   ${paid ? val(o.customer_phone) : notYet}`,
    ``,
    `FULFILLMENT`,
    `  Method:  ${method}`,
    `  Address: ${addr || (/pickup/i.test(method) ? '(pickup — no shipping address)' : notYet)}`,
    ``,
    `GARMENT`,
    `  Product: ${val(o.product_title)}`,
    `  Color:   ${val(o.selected_color)}${o.selected_color_hex ? ` (${o.selected_color_hex})` : ''}`,
    `  Print:   ${printLabel}`,
    `  Sides:   ${val(o.sides_designed)}`,
    ``,
    `SIZES / QUANTITIES`,
    ...qty.lines,
    `  Total: ${qty.total}`,
    ``,
    `DESIGN SUMMARY`,
    `  Front: ${summarizeSide(o.canvas_json_front as string | null)}`,
    `  Back:  ${summarizeSide(o.canvas_json_back as string | null)}`,
    ``,
    `CUT FILES (vector to cut — union'd per color, cropped, no mask; NORMAL + MIRRORED)`,
    `  Cut Files/ = normal (adhesive, print-then-cut) · Cut Files (Mirrored)/ = HTV`,
    ...cutLines,
    ``,
    `LAYOUT (to-size assembly map — EVERY element incl. photos, at placed size/position)`,
    ...layoutLines,
    ``,
    `PREVIEWS`,
    ...previewLines,
    ``,
    `ORIGINALS (best print source)`,
    ...origLines,
    ``,
    `UPLOADS (web-converted, reference)`,
    ...uploadLines,
    ``,
    `${'-'.repeat(50)}`,
    `FOLDERS: Cut Files/ = normal-cut vector (adhesive, print-then-cut) · Cut Files`,
    `(Mirrored)/ = same, flipped for heat-transfer vinyl · Layout/ = to-size map of`,
    `where every element goes (incl. photos) · Previews/ = the mockup the customer`,
    `approved · Originals/ = the file to print from · Uploads/ = web renditions.`,
    `Cut files are union'd + cropped, cutter-ready (no clip mask). Generated on download.`,
  ]
  root.file('OrderInfo.txt', info.join('\n') + '\n')

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
