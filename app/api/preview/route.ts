import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const shirtUrl = searchParams.get('shirt')

  if (!shirtUrl) {
    return NextResponse.json({ error: 'Missing shirt URL' }, { status: 400 })
  }

  try {
    const res = await fetch(shirtUrl, {
      headers: { 'Accept': 'image/*' }
    })
    if (!res.ok) throw new Error(`Failed to fetch shirt: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/png'
    const base64 = buffer.toString('base64')
    return NextResponse.json({
      shirt: `data:${contentType};base64,${base64}`,
    })
  } catch (err) {
    console.error('Preview proxy error:', err)
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
  }
}
