import { NextRequest, NextResponse } from 'next/server'
import { getStoreOrigin } from '../../lib/shopify'

// Pin to the Node runtime — Edge has different APIs around getSetCookie()
// and we don't need the perf benefit here.
export const runtime = 'nodejs'

// Server-side proxy for Shopify's /cart/add.js. Lives at /api/cart-add so the
// browser can call it same-origin (no CORS issue). The server-side fetch to
// Shopify forwards the customer's session cookies (.tshirtdeli.com scope, so
// they reach create.tshirtdeli.com requests).
//
// TODO: idempotency on retry. If a multi-size cart-add fails partway, retrying
// re-adds items 1..N-1 — Shopify treats matching property sets as the same
// line and increments quantity, which would inflate counts. Fix later by
// either (a) generating a per-attempt request ID and including it as a line
// item property, or (b) clearing the cart on the order page before each
// attempt. Not blocking for launch.
export async function POST(request: NextRequest) {
  let storeOrigin: string
  try {
    storeOrigin = getStoreOrigin()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Store domain not configured' },
      { status: 500 }
    )
  }

  // Forward the customer's cookies (HttpOnly Shopify session cookies included —
  // server can read them even though browser JS can't).
  const cookieHeader = request.headers.get('cookie') ?? ''

  // Form-encoded body, relayed verbatim. Shopify expects:
  // id=<n>&quantity=<n>&properties[<key>]=<value>...
  const body = await request.text()

  let shopifyRes: Response
  try {
    shopifyRes = await fetch(`${storeOrigin}/cart/add.js`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Cookie': cookieHeader,
      },
      body,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `Could not reach Shopify (${err.message})` : 'Could not reach Shopify' },
      { status: 502 }
    )
  }

  // Relay Shopify's status, body, and content type back to the browser.
  const responseBody = await shopifyRes.text()
  const response = new NextResponse(responseBody, {
    status: shopifyRes.status,
    headers: {
      'Content-Type': shopifyRes.headers.get('content-type') ?? 'application/json',
    },
  })

  // Forward Set-Cookie headers — critical for first-time visitors (Shopify
  // issues a fresh cart cookie which the browser must store) and session
  // refreshes between sequential adds.
  const setCookies = shopifyRes.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) {
    response.headers.append('set-cookie', cookie)
  }

  return response
}
