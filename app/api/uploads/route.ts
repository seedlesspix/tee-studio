import { NextRequest, NextResponse } from 'next/server'
import {
  serviceClient,
  getCustomerId,
  getSessionId,
  getOrCreateSessionId,
  setSessionCookie,
  UUID_RE,
} from '../../lib/customer-library'

// Node runtime for crypto.randomUUID() + jose (ID-token verify).
export const runtime = 'nodejs'

// "My Uploads" library — an INDEX of customer-uploaded artwork (files live in
// Cloudinary; this table only points at them). Access is entirely
// server-mediated: the owner is derived here (verified Shopify customer id, or
// an anonymous HttpOnly session id) and every query is scoped to it, so the
// browser never names an owner and there is no path to another owner's rows.
// The table has RLS on with no policies — only the service role (this route)
// can touch it.

type UploadRow = {
  id: string
  cloudinary_url: string
  file_name: string
  file_type: string | null
  width: number | null
  height: number | null
}

type UploadDTO = {
  id: string
  url: string
  fileName: string
  fileType: string | null
  width: number | null
  height: number | null
}

const toDTO = (r: UploadRow): UploadDTO => ({
  id: r.id,
  url: r.cloudinary_url,
  fileName: r.file_name,
  fileType: r.file_type,
  width: r.width,
  height: r.height,
})

// GET — list the caller's uploads, newest first.
export async function GET(request: NextRequest) {
  const customerId = await getCustomerId(request)
  const sessionId = getSessionId(request)

  // Non-null owner guard: with no owner we return empty rather than run any
  // query. (Every query below filters by equality to a concrete non-null owner,
  // so it can never match a row whose owner column is null.)
  if (!customerId && !sessionId) return NextResponse.json({ uploads: [] })

  const supabase = serviceClient()
  let query = supabase
    .from('customer_uploads')
    .select('id, cloudinary_url, file_name, file_type, width, height')
    .order('created_at', { ascending: false })
    .limit(200)
  query = customerId
    ? query.eq('shopify_customer_id', customerId)
    : query.eq('session_id', sessionId!)

  const { data, error } = await query
  if (error) {
    console.error('[uploads] list failed:', error)
    return NextResponse.json({ error: 'Could not load uploads' }, { status: 500 })
  }
  return NextResponse.json({ uploads: (data ?? []).map(toDTO) })
}

// POST — record a Cloudinary asset in the caller's library. The client does the
// (unsigned) Cloudinary upload and posts the resulting URL + metadata here; the
// server only writes the index row, scoped to the derived owner.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const cloudinaryUrl = body.cloudinaryUrl
  if (typeof cloudinaryUrl !== 'string' || !/^https:\/\/res\.cloudinary\.com\//.test(cloudinaryUrl)) {
    return NextResponse.json({ error: 'A Cloudinary image URL is required' }, { status: 400 })
  }

  const customerId = await getCustomerId(request)

  // Anonymous: reuse the existing session id or mint a new one to set on the
  // response (HttpOnly, so it never becomes JS-readable).
  let sessionId: string | null = null
  let mintedSession = false
  if (!customerId) {
    const session = getOrCreateSessionId(request)
    sessionId = session.sessionId
    mintedSession = session.isNew
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
  const str = (v: unknown) => (typeof v === 'string' ? v : null)

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('customer_uploads')
    .insert({
      // Exactly one owner is non-null (the CHECK constraint enforces ≥1).
      shopify_customer_id: customerId,
      session_id: customerId ? null : sessionId,
      cloudinary_url: cloudinaryUrl,
      cloudinary_public_id: str(body.cloudinaryPublicId),
      file_name: (str(body.fileName) || 'upload').slice(0, 200),
      file_type: str(body.fileType),
      source: str(body.source),
      width: num(body.width),
      height: num(body.height),
    })
    .select('id, cloudinary_url, file_name, file_type, width, height')
    .single()

  if (error) {
    console.error('[uploads] insert failed:', error)
    return NextResponse.json({ error: 'Could not save upload' }, { status: 500 })
  }

  const response = NextResponse.json({ upload: toDTO(data) })
  if (mintedSession && sessionId) setSessionCookie(response, sessionId)
  return response
}

// DELETE ?id=<uuid> — remove one INDEX row, scoped to the caller. Deliberately
// never deletes the Cloudinary file: it may be referenced by a saved design's
// canvas JSON, so row-removal-only can't break past work.
export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const customerId = await getCustomerId(request)
  const sessionId = getSessionId(request)
  if (!customerId && !sessionId) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }

  const supabase = serviceClient()
  let query = supabase.from('customer_uploads').delete().eq('id', id)
  query = customerId
    ? query.eq('shopify_customer_id', customerId)
    : query.eq('session_id', sessionId!)

  const { error } = await query
  if (error) {
    console.error('[uploads] delete failed:', error)
    return NextResponse.json({ error: 'Could not delete upload' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
