// TEMPORARY SPIKE (Phase 5 auto-trace evaluation) — REMOVE after the go/no-go verdict.
// GET /api/admin/trace-spike?order=<uuid>[&mode=test|production]
// For each raster logo uploaded on an order, traces it BOTH ways — potrace (free, in-process)
// and Vectorizer.AI (API) — and returns a ZIP: original + potrace.svg + vectorizer.svg + info
// (quality gate, anchor counts, Vectorizer credits). Denise compares in Illustrator + reads the
// real per-image cost. mode=test is FREE (Vectorizer still returns X-Credits-Calculated so cost
// is visible without spending); mode=production charges credits + returns clean (unwatermarked) output.
import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import sharp from 'sharp'
import { trace } from 'potrace'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'

export const runtime = 'nodejs'

const allowed = () => (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
type UploadedFile = { name?: string; url?: string; type?: string; originalUrl?: string; originalFormat?: string }
const anchors = (svg: string) => (svg.match(/[MLCQmlcqAaSsTtHhVv]/g) || []).length

function potraceTrace(mask: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    trace(mask, { turdSize: 2, optCurve: true, alphaMax: 1, threshold: 128 }, (err: Error | null, svg: string) => (err ? reject(err) : resolve(svg)))
  })
}

// Bi-level black-on-white mask for potrace. Transparent-bg logos (the store's "white-on-transparent"
// case) trace their ALPHA (shape = opaque, ink color irrelevant); opaque images trace luminance.
async function toMask(buf: Buffer): Promise<{ mask: Buffer; method: string }> {
  const meta = await sharp(buf).metadata()
  if (meta.hasAlpha) {
    const { data } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
    let transparent = 0
    const step = Math.max(1, Math.floor(data.length / 8192))
    for (let i = 0; i < data.length; i += step) if (data[i] < 128) transparent++
    if (transparent > 0) {
      const mask = await sharp(buf).ensureAlpha().extractChannel(3).negate().threshold(128).png().toBuffer()
      return { mask, method: 'alpha' }
    }
  }
  const mask = await sharp(buf).flatten({ background: '#ffffff' }).greyscale().threshold(128).png().toBuffer()
  return { mask, method: 'luminance' }
}

// Quality gate: is this a one-color/simple image (cuttable) or a photo (not)?
async function gate(buf: Buffer): Promise<{ colors: number; top2: number; cuttable: boolean }> {
  const { data, info } = await sharp(buf).resize(80, 80, { fit: 'inside' }).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true })
  const counts = new Map<string, number>()
  for (let i = 0; i < data.length; i += info.channels) {
    const k = (data[i] >> 5) + '_' + (data[i + 1] >> 5) + '_' + (data[i + 2] >> 5)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const total = data.length / info.channels
  const top2 = [...counts.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / total
  return { colors: counts.size, top2, cuttable: top2 > 0.85 && counts.size < 24 }
}

async function vectorizerTrace(buf: Buffer, mode: string): Promise<{ svg: string; calculated: string | null; charged: string | null; error?: string }> {
  const id = process.env.VECTORIZER_AI_API_ID, secret = process.env.VECTORIZER_AI_API_SECRET
  if (!id || !secret) return { svg: '', calculated: null, charged: null, error: 'VECTORIZER_AI_API_ID / VECTORIZER_AI_API_SECRET not set in env' }
  const auth = Buffer.from(`${id}:${secret}`).toString('base64')
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(buf)]), 'image.png')
  form.append('mode', mode)
  form.append('output.file_format', 'svg')
  const res = await fetch('https://vectorizer.ai/api/v1/vectorize', { method: 'POST', headers: { Authorization: `Basic ${auth}` }, body: form })
  const calculated = res.headers.get('X-Credits-Calculated')
  const charged = res.headers.get('X-Credits-Charged')
  if (!res.ok) return { svg: '', calculated, charged, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` }
  return { svg: await res.text(), calculated, charged }
}

export async function GET(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user?.email || !allowed().includes(user.email.toLowerCase())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const u = new URL(req.url)
  const orderId = u.searchParams.get('order') || ''
  const mode = u.searchParams.get('mode') === 'production' ? 'production' : 'test'
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ error: 'bad order id' }, { status: 400 })

  const { data: o } = await serviceClient().from('design_orders').select('uploaded_files,shopify_order_number').eq('id', orderId).maybeSingle()
  if (!o) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  const uploads = Array.isArray(o.uploaded_files) ? (o.uploaded_files as UploadedFile[]) : []

  const zip = new JSZip()
  const root = zip.folder(`trace-spike-${o.shopify_order_number || orderId.slice(0, 8)}`)!
  const summary: string[] = [
    `TRACE SPIKE — potrace (free) vs Vectorizer.AI   ·   mode=${mode}`,
    `Fewer anchors + cleaner curves = better. Open each folder's two .svg in Illustrator.`,
    ``,
  ]
  let did = 0
  for (let i = 0; i < uploads.length; i++) {
    const f = uploads[i]
    const isRaster = (f.type || '').startsWith('image/') && !(f.type || '').includes('svg')
    if (!f.url || !isRaster) continue
    let buf: Buffer
    try {
      const r = await fetch(f.url)
      if (!r.ok) { summary.push(`✗ ${f.name}: fetch ${r.status}`); continue }
      buf = Buffer.from(await r.arrayBuffer())
    } catch (e) { summary.push(`✗ ${f.name}: ${(e as Error).message}`); continue }

    const base = (f.name || `logo-${i + 1}`).replace(/[/\\]/g, '_').replace(/\.[^.]+$/, '')
    const fold = root.folder(base)!
    fold.file(`${base}-original${f.originalFormat ? '' : '.png'}`, buf)
    const info: string[] = [`Logo: ${f.name}`, ``]

    try {
      const g = await gate(buf)
      info.push(`GATE: ${g.colors} quantized colors, top-2 cover ${(g.top2 * 100).toFixed(0)}% of pixels`, `      -> ${g.cuttable ? 'CUTTABLE (one-color art)' : 'NOT one-color (photo?) — auto-trace not appropriate'}`, ``)
    } catch (e) { info.push(`GATE: err ${(e as Error).message}`, ``) }

    try {
      const { mask, method } = await toMask(buf)
      const svg = await potraceTrace(mask)
      fold.file(`${base}-potrace.svg`, svg)
      info.push(`POTRACE (${method}-mask, free): ${anchors(svg)} anchors, ${svg.length} bytes`)
    } catch (e) { info.push(`POTRACE: err ${(e as Error).message}`) }

    try {
      const v = await vectorizerTrace(buf, mode)
      if (v.error) info.push(`VECTORIZER.AI: ${v.error}`)
      else {
        fold.file(`${base}-vectorizer.svg`, v.svg)
        info.push(`VECTORIZER.AI (${mode}): ${anchors(v.svg)} anchors, ${v.svg.length} bytes`, `      credits: calculated=${v.calculated ?? '?'}  charged=${v.charged ?? '0'}`)
      }
    } catch (e) { info.push(`VECTORIZER.AI: err ${(e as Error).message}`) }

    fold.file('info.txt', info.join('\n') + '\n')
    summary.push(`• ${f.name} → ${base}/  (potrace.svg + vectorizer.svg + info.txt)`)
    did++
  }
  if (did === 0) summary.push(`(no raster image uploads on this order — pick an order whose customer uploaded a PNG/JPG logo)`)
  root.file('SUMMARY.txt', summary.join('\n') + '\n')

  const body = await zip.generateAsync({ type: 'arraybuffer' })
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="trace-spike-${orderId.slice(0, 8)}-${mode}.zip"`, 'Cache-Control': 'no-store' },
  })
}
