// Remove Background proxy (Phase 5, customer-facing) — keeps the remove.bg API key server-side.
//
// URL-in / URL-out so NOTHING big transits this function (Vercel caps request AND response bodies
// at ~4.5MB — a real phone photo blows both): the client sends the image's existing Cloudinary URL,
// remove.bg fetches it itself, and we re-host the cutout on Cloudinary and return only the new URL.
//
// ⚠️ PRE-LAUNCH: this endpoint spends paid remove.bg credits and is UNAUTHENTICATED (the designer
//    has no customer login). Add a rate limit / light gate before launch so it can't be spammed.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const key = process.env.REMOVE_BG_API_KEY
  if (!key) {
    console.error('[remove-bg] REMOVE_BG_API_KEY is not set in this deployment')
    return NextResponse.json({ error: "Remove Background isn't set up yet (no API key — add REMOVE_BG_API_KEY and redeploy)." }, { status: 503 })
  }

  try {
    let imageUrl: string | undefined
    try { ({ imageUrl } = await req.json()) } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return NextResponse.json({ error: 'A hosted image URL is required.' }, { status: 400 })

    // 1. remove.bg via image_url — the request stays tiny; remove.bg fetches the image itself.
    const form = new FormData()
    form.append('image_url', imageUrl)
    form.append('size', 'auto') // full-resolution result (1 credit)
    let res: Response
    try {
      res = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form })
    } catch (e) {
      console.error('[remove-bg] network error reaching remove.bg', e)
      return NextResponse.json({ error: 'Network error — the server could not reach remove.bg.' }, { status: 502 })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[remove-bg] remove.bg failed', res.status, body.slice(0, 800))
      let detail = ''
      try { detail = JSON.parse(body)?.errors?.[0]?.title || '' } catch { /* non-JSON */ }
      const category =
        res.status === 401 || res.status === 403 ? 'authentication — the REMOVE_BG_API_KEY looks wrong or unauthorized'
        : res.status === 402 ? 'quota/credits — the remove.bg account is out of credits'
        : res.status === 429 ? 'rate limit — too many requests, wait a moment'
        : res.status === 400 ? 'remove.bg rejected the image (is the image URL publicly reachable?)'
        : `remove.bg returned ${res.status}`
      return NextResponse.json({ error: `Background removal failed: ${category}${detail ? ` — ${detail}` : ''}.` }, { status: 502 })
    }
    const cutout = Buffer.from(await res.arrayBuffer())

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
    return new NextResponse(cutout, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[remove-bg] unexpected server error', e)
    return NextResponse.json({ error: 'Unexpected server error during background removal.' }, { status: 500 })
  }
}
