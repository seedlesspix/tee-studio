import type { NextRequest, NextResponse } from 'next/server'
import type { TokenBundle } from './customer-account'

// Long-lived session cookie names. Tokens never reach the browser — JS can't
// read HttpOnly cookies, and our routes are the only thing that talk to
// Shopify on the customer's behalf.
const SESSION_COOKIE_NAMES = [
  'cust_at',
  'cust_rt',
  'cust_id_token',
  'cust_at_exp',
] as const

// Short-lived OAuth-flow cookie names. Set by /api/customer/login,
// consumed (and deleted) by /auth/customer/callback. No PKCE verifier —
// we're a confidential client and Shopify's token endpoint rejects PKCE
// alongside client_secret_basic.
const OAUTH_FLOW_COOKIE_NAMES = [
  'cust_oauth_state',
  'cust_oauth_nonce',
  'cust_oauth_return_to',
] as const

// Common cookie attributes for both kinds. No Domain attribute → host-only on
// create.tshirtdeli.com (or the dev tunnel host), which is the canonical
// pattern for cookies tied to a single subdomain.
const baseCookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
}

export type OAuthFlowCookies = {
  state: string | undefined
  nonce: string | undefined
  returnTo: string | undefined
}

export function readOAuthFlowCookies(request: NextRequest): OAuthFlowCookies {
  return {
    state: request.cookies.get('cust_oauth_state')?.value,
    nonce: request.cookies.get('cust_oauth_nonce')?.value,
    returnTo: request.cookies.get('cust_oauth_return_to')?.value,
  }
}

export function clearOAuthFlowCookies(response: NextResponse): void {
  for (const name of OAUTH_FLOW_COOKIE_NAMES) {
    response.cookies.set(name, '', { ...baseCookieOpts, maxAge: 0 })
  }
}

// Writes the four long-lived session cookies on the given response.
// `cust_at` and `cust_id_token` lifetime tracks the access-token expiry
// (~1h per Shopify). `cust_rt` lifetime tracks the refresh-token expiry
// (~30d per Shopify). `cust_at_exp` mirrors `cust_at` lifetime and stores
// the absolute expiry as an epoch-ms string so /api/customer/me can decide
// whether to proactively refresh without parsing the JWT.
export function setSessionCookies(response: NextResponse, bundle: TokenBundle): void {
  const now = Date.now()
  const accessMaxAge = Math.max(0, Math.floor((bundle.accessTokenExpiresAt - now) / 1000))
  const refreshMaxAge = Math.max(0, Math.floor((bundle.refreshTokenExpiresAt - now) / 1000))

  response.cookies.set('cust_at', bundle.accessToken, {
    ...baseCookieOpts,
    maxAge: accessMaxAge,
  })
  response.cookies.set('cust_id_token', bundle.idToken, {
    ...baseCookieOpts,
    maxAge: accessMaxAge,
  })
  response.cookies.set('cust_at_exp', String(bundle.accessTokenExpiresAt), {
    ...baseCookieOpts,
    maxAge: accessMaxAge,
  })
  response.cookies.set('cust_rt', bundle.refreshToken, {
    ...baseCookieOpts,
    maxAge: refreshMaxAge,
  })
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of SESSION_COOKIE_NAMES) {
    response.cookies.set(name, '', { ...baseCookieOpts, maxAge: 0 })
  }
}
