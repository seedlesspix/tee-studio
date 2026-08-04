// Remove Background proxy (Phase 5, customer-facing) — keeps the remove.bg API key server-side.
// The designer POSTs the selected image; we call remove.bg and stream back the transparent PNG.
// Denise's verdict: Cloudinary's AI removal is unavailable (post-Feb-2026 account) -> remove.bg.
//
// ⚠️ PRE-LAUNCH: this endpoint spends paid remove.bg credits and is UNAUTHENTICATED (the designer
//    has no customer login). Add a rate limit / light gate before launch so it can't be spammed to
//    burn credits.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_B64 = 12 * 1024 * 1024 // ~9MB image; reject oversize before spending a remove.bg call

export async function POST(req: NextRequest) {
  const key = process.env.REMOVE_BG_API_KEY
  if (!key) {
    console.error('[remove-bg] REMOVE_BG_API_KEY is not set in this deployment')
    return NextResponse.json({ error: "Remove Background isn't set up yet (no API key on the server — add REMOVE_BG_API_KEY and redeploy)." }, { status: 503 })
  }

  try {
    let imageBase64: string | undefined
    try { ({ imageBase64 } = await req.json()) } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }
    if (!imageBase64 || typeof imageBase64 !== 'string') return NextResponse.json({ error: 'no image' }, { status: 400 })
    if (imageBase64.length > MAX_B64) return NextResponse.json({ error: 'That image is too large to process.' }, { status: 413 })

    const b64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64
    const form = new FormData()
    form.append('image_file_b64', b64)
    form.append('size', 'auto') // full-resolution result (1 credit)

    let res: Response
    try {
      res = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form })
    } catch (e) {
      console.error('[remove-bg] network error reaching remove.bg', e)
      return NextResponse.json({ error: 'Network error — the server could not reach remove.bg.' }, { status: 502 })
    }

    if (!res.ok) {
      // Log the FULL cause for admin eyes (Vercel logs); return a category in the message too.
      const bodyText = await res.text().catch(() => '')
      console.error('[remove-bg] remove.bg failed', res.status, bodyText.slice(0, 800))
      let detail = ''
      try { detail = JSON.parse(bodyText)?.errors?.[0]?.title || '' } catch { /* non-JSON */ }
      const category =
        res.status === 401 || res.status === 403 ? 'authentication — the REMOVE_BG_API_KEY looks wrong or unauthorized'
        : res.status === 402 ? 'quota/credits — the remove.bg account is out of credits'
        : res.status === 429 ? 'rate limit — too many requests, wait a moment'
        : res.status === 400 ? 'the image was rejected by remove.bg'
        : `remove.bg returned ${res.status}`
      return NextResponse.json({ error: `Background removal failed: ${category}${detail ? ` — ${detail}` : ''}.` }, { status: 502 })
    }

    const png = Buffer.from(await res.arrayBuffer())
    return new NextResponse(png, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[remove-bg] unexpected server error', e)
    return NextResponse.json({ error: 'Unexpected server error during background removal.' }, { status: 500 })
  }
}
