// Remove Background proxy (Phase 5, customer-facing) — keeps the remove.bg API key server-side.
// The designer POSTs the selected image; we call remove.bg and stream back the transparent PNG.
// Denise's verdict: Cloudinary's AI removal is unavailable (post-Feb-2026 account) -> remove.bg.
//
// ⚠️ PRE-LAUNCH: this endpoint spends paid remove.bg credits and is UNAUTHENTICATED (the designer
//    has no customer login). Add a rate limit / light gate before launch so it can't be spammed to
//    burn credits. Scaffolded now, waiting on REMOVE_BG_API_KEY.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MAX_B64 = 12 * 1024 * 1024 // ~9MB image; reject oversize before spending a remove.bg call

export async function POST(req: NextRequest) {
  const key = process.env.REMOVE_BG_API_KEY
  if (!key) return NextResponse.json({ error: "Remove Background isn't set up yet." }, { status: 503 })

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
  } catch {
    return NextResponse.json({ error: 'Could not reach the background remover. Please try again.' }, { status: 502 })
  }
  if (!res.ok) {
    let msg = `Background removal failed (${res.status}).`
    try { const j = await res.json(); msg = j?.errors?.[0]?.title ? `Background removal failed: ${j.errors[0].title}` : msg } catch { /* non-JSON */ }
    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const png = Buffer.from(await res.arrayBuffer())
  return new NextResponse(png, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } })
}
