import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const shirtUrl = searchParams.get('shirt')
  const designUrl = searchParams.get('design')

  if (!shirtUrl || !designUrl) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  try {
    // Fetch both images server-side (no CORS issues)
    const [shirtRes, designRes] = await Promise.all([
      fetch(shirtUrl),
      fetch(designUrl),
    ])

    const shirtBuffer = Buffer.from(await shirtRes.arrayBuffer())
    const designBuffer = Buffer.from(await designRes.arrayBuffer())

    // Return as base64 JSON for client to use
    return NextResponse.json({
      shirt: `data:image/png;base64,${shirtBuffer.toString('base64')}`,
      design: `data:image/png;base64,${designBuffer.toString('base64')}`,
    })
  } catch (err) {
    console.error('Preview error:', err)
    return NextResponse.json({ error: 'Failed to fetch images' }, { status: 500 })
  }
}
