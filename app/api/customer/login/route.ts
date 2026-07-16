import { NextRequest, NextResponse } from 'next/server'
import {
  buildAuthorizeUrl,
  generateRandom,
  getRedirectUri,
} from '../../../lib/customer-account'

// Node runtime — we use node:crypto for randomness.
export const runtime = 'nodejs'

// GET /api/customer/login?return_to=<path>
//
// Initiates the Shopify Customer Account API OAuth flow. Generates an OAuth
// state (CSRF) and an OIDC nonce (replay), stashes them in short-lived
// HttpOnly cookies, then 302s the browser to the discovered authorization
// endpoint. /auth/customer/callback validates state, swaps the code for
// tokens, and consumes the cookies.
//
// We are a confidential client (we hold a client_secret server-side) and
// authenticate at the token endpoint via client_secret_basic. Per Shopify's
// Customer Account API docs, PKCE is "public client only" — sending a
// code_verifier alongside Basic auth makes the token endpoint return
// invalid_client. So no PKCE here.
//
// Day 5 will swap this to POST and accept a canvas snapshot, write a draft
// row to design_orders, and stash the UUID in cust_oauth_draft_id for
// /auth/customer/callback to pick up.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const returnToParam = url.searchParams.get('return_to') ?? '/'

  // Open-redirect guard: only same-origin paths are allowed. Reject absolute
  // URLs and protocol-relative `//evil.com` variants.
  const safeReturnTo =
    returnToParam.startsWith('/') && !returnToParam.startsWith('//')
      ? returnToParam
      : '/'

  let authorizeUrl: string
  let state: string
  let nonce: string
  try {
    state = generateRandom()
    nonce = generateRandom()
    authorizeUrl = await buildAuthorizeUrl({
      state,
      nonce,
      redirectUri: getRedirectUri(),
    })
  } catch (err) {
    console.error('[customer/login] failed to build authorize URL:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Login configuration error' },
      { status: 500 },
    )
  }

  const response = NextResponse.redirect(authorizeUrl)

  // Host-only on create.tshirtdeli.com (no Domain attribute), HttpOnly so
  // the browser never exposes them to JS, SameSite=Lax so they're sent on
  // the top-level redirect back from account.tshirtdeli.com. 10 min is
  // plenty of time for a user to finish consent.
  const flowCookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 10,
  }

  response.cookies.set('cust_oauth_state', state, flowCookieOpts)
  response.cookies.set('cust_oauth_nonce', nonce, flowCookieOpts)
  response.cookies.set('cust_oauth_return_to', safeReturnTo, flowCookieOpts)

  return response
}
