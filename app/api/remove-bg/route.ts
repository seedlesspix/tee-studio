// Remove Background proxy (Phase 5, customer-facing) — keeps the provider API key server-side.
//
// URL-in / URL-out so NOTHING big transits this function (Vercel caps request AND response bodies
// at ~4.5MB — a real phone photo blows both): the client sends the image's existing Cloudinary URL,
// the provider fetches it itself, and we download the cutout, re-host it on Cloudinary and return
// only the new URL. Order artwork is kept forever, so the re-host is mandatory (Leonardo's result
// links expire in ~30 minutes).
//
// PROVIDER: Leonardo.Ai (LEONARDO_API_KEY) — the successor to remove.bg, whose self-serve API ends on
// 1 December 2026. Cutover confirmed in production 2026-10-30; the remove.bg path is gone, so a missing
// key fails loudly (503) instead of falling back to a dead vendor. Request/response shapes (as observed
// in production, not as the migration guide describes them) and the customer-facing wording live in
// app/lib/backgroundRemoval.ts (pure, tested). Unauthenticated endpoint that spends paid credits per call → gated: same-site
// origin + per-IP throttle + a per-instance hourly credit circuit-breaker (see rateLimit.ts).
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, clientIp, originAllowed } from '../../lib/server/rateLimit'
import {
  pickProvider, buildLeonardoRequest, parseLeonardoResult, describeProviderFailure, extractErrorDetail,
  extractLeonardoError, type Provider,
} from '../../lib/backgroundRemoval'

export const runtime = 'nodejs'
export const maxDuration = 60 // Leonardo's sync call renders before answering; a big photo can take a while

// Abuse limits (env-overridable, no redeploy-code needed).
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }
const PER_IP_MIN = num(process.env.REMOVE_BG_RL_PER_MIN, 8)
const PER_IP_HOUR = num(process.env.REMOVE_BG_RL_PER_HOUR, 40)
const GLOBAL_HOUR = num(process.env.REMOVE_BG_RL_GLOBAL_HOUR, 300)

const PROVIDER_TIMEOUT_MS = 45_000

// Call the chosen provider and return the cutout's PNG bytes, or a ready-to-send error response.
async function fetchCutout(provider: Provider, key: string, imageUrl: string): Promise<{ bytes: Buffer } | { error: NextResponse }> {
  const req = buildLeonardoRequest(imageUrl, key)
  const vendor = 'Leonardo.Ai'
  let res: Response
  try {
    res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  } catch (e) {
    console.error(`[remove-bg] network error reaching ${vendor}`, e)
    return { error: NextResponse.json({ error: `Network error — the server could not reach ${vendor}.` }, { status: 502 }) }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[remove-bg] ${vendor} failed`, res.status, body.slice(0, 800))
    const detail = extractErrorDetail(body)
    return { error: NextResponse.json({ error: `Background removal failed: ${describeProviderFailure(provider, res.status)}${detail ? ` — ${detail}` : ''}.` }, { status: 502 }) }
  }
  // Leonardo answers JSON with a short-lived download link (and what the call cost) → fetch the bytes now.
  const json = await res.json().catch(() => null)
  const result = parseLeonardoResult(json)
  if (!result) {
    // A 200 can still carry Leonardo's validation errors (production, 2026-10-30) — say what it said.
    const rejected = extractLeonardoError(json)
    console.error('[remove-bg] Leonardo returned no result', rejected ?? 'unexpected shape', JSON.stringify(json).slice(0, 800))
    return { error: NextResponse.json({ error: rejected ? `Background removal failed: Leonardo.Ai rejected the request — ${rejected}.` : 'Background removal failed: Leonardo.Ai returned an unexpected response.' }, { status: 502 }) }
  }
  if (result.costUsd != null) console.log(`[remove-bg] leonardo ok cost=$${result.costUsd} ${result.width ?? '?'}x${result.height ?? '?'}`)
  let dl: Response
  try {
    dl = await fetch(result.url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  } catch (e) {
    console.error('[remove-bg] could not download the Leonardo result', e)
    return { error: NextResponse.json({ error: 'Background removal failed: the cutout could not be downloaded.' }, { status: 502 }) }
  }
  if (!dl.ok) {
    console.error('[remove-bg] Leonardo result download failed', dl.status)
    return { error: NextResponse.json({ error: `Background removal failed: the cutout download returned ${dl.status}.` }, { status: 502 }) }
  }
  return { bytes: Buffer.from(await dl.arrayBuffer()) }
}

export async function POST(req: NextRequest) {
  const chosen = pickProvider({ LEONARDO_API_KEY: process.env.LEONARDO_API_KEY })
  if (!chosen) {
    console.error('[remove-bg] no background-removal key is set in this deployment (LEONARDO_API_KEY)')
    return NextResponse.json({ error: "Remove Background isn't set up yet (no API key — add LEONARDO_API_KEY and redeploy)." }, { status: 503 })
  }

  // Gate before spending anything: reject off-site origins, then per-IP + global rate limits.
  if (!originAllowed(req.headers)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  const ip = clientIp(req.headers)
  const limits: Array<[string, number, number]> = [
    [`rbg:min:${ip}`, PER_IP_MIN, 60_000],       // per-IP short burst
    [`rbg:hr:${ip}`, PER_IP_HOUR, 3_600_000],    // per-IP hourly
    ['rbg:global:hr', GLOBAL_HOUR, 3_600_000],   // per-instance credit circuit-breaker (IP-spoof-proof)
  ]
  for (const [rlKey, limit, windowMs] of limits) {
    const rl = rateLimit(rlKey, limit, windowMs)
    if (!rl.ok) {
      console.error('[remove-bg] rate limited', rlKey, 'retryAfter', rl.retryAfterSec)
      return NextResponse.json(
        { error: 'Too many background-removal requests right now — please wait a bit and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }
  }

  try {
    let imageUrl: string | undefined
    try { ({ imageUrl } = await req.json()) } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }
    if (!imageUrl || !/^https:\/\//.test(imageUrl)) return NextResponse.json({ error: 'A hosted https image URL is required.' }, { status: 400 })

    // 1. The provider does the work from the hosted URL — the request stays tiny.
    const got = await fetchCutout(chosen.provider, chosen.key, imageUrl)
    if ('error' in got) return got.error
    const cutout = got.bytes

    // 2. Re-host the cutout on Cloudinary so only a URL flows BACK (dodges the response cap too).
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
    const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
    if (cloudName && preset) {
      try {
        const fd = new FormData()
        fd.append('file', `data:image/png;base64,${cutout.toString('base64')}`)
        fd.append('upload_preset', preset)
        const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: fd })
        if (up.ok) {
          const d = await up.json()
          if (d?.secure_url) return NextResponse.json({ url: d.secure_url })
        }
        console.error('[remove-bg] cloudinary rehost failed', up.status, (await up.text().catch(() => '')).slice(0, 300))
      } catch (e) { console.error('[remove-bg] rehost error', e) }
    }
    // Fallback: stream the PNG (fine for small cutouts; may hit the ~4.5MB response cap for large ones).
    return new NextResponse(new Uint8Array(cutout), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[remove-bg] unexpected server error', e)
    return NextResponse.json({ error: 'Unexpected server error during background removal.' }, { status: 500 })
  }
}
