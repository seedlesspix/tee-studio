import { randomUUID } from 'node:crypto'
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
  const reqId = randomUUID().slice(0, 8)

  let storeOrigin: string
  try {
    storeOrigin = getStoreOrigin()
  } catch (err) {
    console.error(`[cart-add ${reqId}] store domain misconfigured:`, err)
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

  // Cookie names only (not values) — useful to confirm Shopify session
  // cookies are reaching us without leaking anything sensitive to logs.
  const cookieNames = cookieHeader
    .split(';')
    .map(c => c.trim().split('=')[0])
    .filter(Boolean)

  const targetUrl = `${storeOrigin}/cart/add.js`
  console.log(`[cart-add ${reqId}] →`, targetUrl)
  console.log(`[cart-add ${reqId}] body:`, body)
  console.log(`[cart-add ${reqId}] cookie names:`, cookieNames)

  let shopifyRes: Response
  try {
    shopifyRes = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Cookie': cookieHeader,
      },
      body,
    })
  } catch (err) {
    console.error(`[cart-add ${reqId}] fetch threw:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? `Could not reach Shopify (${err.message})` : 'Could not reach Shopify' },
      { status: 502 }
    )
  }

  // Crucial diagnostic: shopifyRes.url shows where we actually ended up
  // after any redirects (fetch defaults to redirect: 'follow'). If this
  // differs from targetUrl, Shopify redirected us — likely to /cart.
  console.log(`[cart-add ${reqId}] ← status:`, shopifyRes.status)
  console.log(`[cart-add ${reqId}] ← final url:`, shopifyRes.url)
  console.log(`[cart-add ${reqId}] ← redirected:`, shopifyRes.redirected)
  console.log(`[cart-add ${reqId}] ← content-type:`, shopifyRes.headers.get('content-type'))
  console.log(`[cart-add ${reqId}] ← location:`, shopifyRes.headers.get('location'))

  // Relay Shopify's status, body, and content type back to the browser.
  const responseBody = await shopifyRes.text()
  console.log(`[cart-add ${reqId}] ← body[0..200]:`, responseBody.slice(0, 200))

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
