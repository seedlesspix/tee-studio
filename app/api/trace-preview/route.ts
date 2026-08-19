// Customer-facing cut-edge PREVIEW (Lens 2). POST { url } -> { svg, checked }.
// Runs the SAME production trace the fulfillment bench gets (autoTraceSvg — potrace), so the customer
// sees the EXACT edges that would be cut (parity, same spirit as type-on-path on-screen/cut parity).
//   { checked:true,  svg:"<svg…>" } — cuttable one-color art (show the outline)
//   { checked:true,  svg:null      } — traced-but-not-cuttable (photo/multi-color): printed, not cut
//   { checked:false, svg:null      } — we could NOT read/trace the file (fetch/timeout/size/host): the
//                                      client shows NO cut verdict, never a false "printed, not cut".
//
// This is the ONLY place autoTrace is exposed unauthenticated (the designer is anonymous), so it is
// guarded like the other spend-y public routes (remove-bg): same-origin only, per-IP + global rate
// limits, an EXACT upload-host allowlist (our Supabase project + Cloudinary — NOT any *.supabase.co,
// which an attacker can register), redirects DISABLED (a redirect can't bounce an allowed host to an
// internal/metadata address), and a STREAMED size cap (content-length lies; never buffer the whole body).
import { NextRequest, NextResponse } from 'next/server'
import { traceForCut } from '../../lib/server/autoTrace'
import { rateLimit, clientIp, originAllowed } from '../../lib/server/rateLimit'

export const runtime = 'nodejs' // sharp + potrace

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB — a real phone photo is well under; rejects abuse
const FETCH_TIMEOUT_MS = 12_000
const PER_IP_MIN = 40      // short-burst per IP (a customer opens the modal a handful of times)
const PER_IP_HOUR = 300
const GLOBAL_HOUR = 4000   // per-instance circuit-breaker (IP-spoof-proof)

// The EXACT hosts an upload URL (_uploadSrc) legitimately lives on: our Supabase project (from env) and
// Cloudinary. Deliberately NOT a *.supabase.co suffix match — that admits any attacker-registered project.
function allowedHost(host: string): boolean {
  if (host === 'res.cloudinary.com') return true
  try {
    const sb = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null
    return !!sb && host === sb
  } catch { return false }
}

// Read the body while enforcing MAX_BYTES on the ACTUAL stream — content-length is optional/spoofable, so
// we count bytes as they arrive and abort the moment the cap is crossed (never buffer an unbounded body).
async function readCapped(res: Response): Promise<Uint8Array | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); return null }
        chunks.push(value)
      }
    }
  } catch { return null }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

async function readBytes(url: string): Promise<Uint8Array | null> {
  // data:image/...;base64,<payload>
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma < 0 || !/^data:image\//i.test(url)) return null
    const meta = url.slice(5, comma)
    const payload = url.slice(comma + 1)
    try {
      const buf = /;base64/i.test(meta) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
      return buf.length > MAX_BYTES ? null : new Uint8Array(buf)
    } catch { return null }
  }
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:' || !allowedHost(parsed.host)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    // redirect:'manual' — a 3xx surfaces as a non-ok response (rejected below) instead of being followed
    // to an unvalidated host. This is the SSRF backstop: an allowed host can't 302 us to an internal IP.
    const res = await fetch(parsed.toString(), { signal: ctrl.signal, redirect: 'manual' })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > MAX_BYTES) return null
    return await readCapped(res)
  } catch { return null }
  finally { clearTimeout(timer) }
}

export async function POST(req: NextRequest) {
  // Gate before spending anything: reject off-site origins, then per-IP + global rate limits.
  if (!originAllowed(req.headers)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  const ip = clientIp(req.headers)
  const limits: Array<[string, number, number]> = [
    [`trace:min:${ip}`, PER_IP_MIN, 60_000],
    [`trace:hr:${ip}`, PER_IP_HOUR, 3_600_000],
    ['trace:global:hr', GLOBAL_HOUR, 3_600_000],
  ]
  for (const [rlKey, limit, windowMs] of limits) {
    const rl = rateLimit(rlKey, limit, windowMs)
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests — please wait a moment.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  }

  let url: unknown
  try { ({ url } = await req.json()) } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  if (typeof url !== 'string' || !url) return NextResponse.json({ error: 'A url is required' }, { status: 400 })

  const bytes = await readBytes(url)
  // checked:false — we never read/traced the file, so the client must NOT claim "printed, not cut".
  if (!bytes) return NextResponse.json({ svg: null, checked: false })
  // reason lets the preview say WHICH problem the art has (colors vs fuzzy edges) and — crucially — split
  // the "not cuttable" message by garment (on darks a failed trace means clean-up-then-cut, not print).
  const { svg, reason } = await traceForCut(bytes)
  return NextResponse.json({ svg: svg ?? null, checked: true, reason })
}
