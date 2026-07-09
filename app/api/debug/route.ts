import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

// Node runtime for node:crypto (constant-time compare).
export const runtime = 'nodejs'

// GET /api/debug?secret=<DEBUG_SECRET>
//
// Env sanity check for diagnosing Customer Account API config. Gated behind a
// shared secret and fails CLOSED: if DEBUG_SECRET is unset, or the provided
// secret is missing/wrong, we return 404 (not 401) so the endpoint's existence
// isn't advertised. Never returns any bytes of the client secret — only whether
// it's set and its length, which is all that's useful for diagnosing config.

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  const expected = process.env.DEBUG_SECRET
  const provided = new URL(request.url).searchParams.get('secret') ?? ''

  if (!expected || !secretMatches(provided, expected)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const clientSecret = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET
  return NextResponse.json({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET_set:
      typeof clientSecret === 'string' && clientSecret.length > 0,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET_length: clientSecret?.length ?? 0,
    SHOPIFY_STOREFRONT_DOMAIN: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    redirectUri: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')}/auth/customer/callback`,
  })
}
