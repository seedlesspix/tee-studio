import { NextRequest, NextResponse } from 'next/server'
import {
  refreshTokens,
  verifyIdTokenNoNonce,
  type IdTokenClaims,
  type TokenBundle,
} from '../../../lib/customer-account'
import { clearSessionCookies, setSessionCookies } from '../../../lib/customer-session'

export const runtime = 'nodejs'

// GET /api/customer/me
//
// Returns { loggedIn: boolean, customer?: {...} }.
//
// Fast, network-free on the hot path: after the first request (which primes
// the JWKS + discovery caches), verifying the ID token signature is CPU-only.
// We never hit Shopify's GraphQL API here — everything the button needs
// (email, given/family name, id) is in the ID token claims.
//
// Access-token refresh happens transparently when the current access token
// is within REFRESH_SKEW_MS of expiring. On refresh failure the session is
// treated as terminated and all cust_* cookies are cleared.
const REFRESH_SKEW_MS = 60 * 1000

type CustomerSummary = {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
}

type MeResponse =
  | { loggedIn: true; customer: CustomerSummary }
  | { loggedIn: false }

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get('cust_at')?.value
  const refreshToken = request.cookies.get('cust_rt')?.value
  const idToken = request.cookies.get('cust_id_token')?.value
  const accessExpRaw = request.cookies.get('cust_at_exp')?.value

  if (!accessToken || !idToken || !accessExpRaw) {
    return NextResponse.json<MeResponse>({ loggedIn: false })
  }

  const accessTokenExpiresAt = Number(accessExpRaw)
  const needsRefresh =
    !Number.isFinite(accessTokenExpiresAt) ||
    accessTokenExpiresAt - Date.now() < REFRESH_SKEW_MS

  let activeIdToken = idToken
  let refreshedBundle: TokenBundle | null = null

  if (needsRefresh) {
    if (!refreshToken) {
      const res = NextResponse.json<MeResponse>({ loggedIn: false })
      clearSessionCookies(res)
      return res
    }
    try {
      refreshedBundle = await refreshTokens(refreshToken)
      activeIdToken = refreshedBundle.idToken
    } catch (err) {
      console.error('[customer/me] token refresh failed:', err)
      const res = NextResponse.json<MeResponse>({ loggedIn: false })
      clearSessionCookies(res)
      return res
    }
  }

  let claims: IdTokenClaims
  try {
    claims = await verifyIdTokenNoNonce(activeIdToken)
  } catch (err) {
    console.error('[customer/me] ID token verification failed:', err)
    const res = NextResponse.json<MeResponse>({ loggedIn: false })
    clearSessionCookies(res)
    return res
  }

  const customer: CustomerSummary = {
    id: String(claims.sub),
    email: typeof claims.email === 'string' ? claims.email : null,
    firstName: typeof claims.given_name === 'string' ? claims.given_name : null,
    lastName: typeof claims.family_name === 'string' ? claims.family_name : null,
  }

  const response = NextResponse.json<MeResponse>({ loggedIn: true, customer })
  if (refreshedBundle) {
    setSessionCookies(response, refreshedBundle)
  }
  return response
}
