import { NextRequest, NextResponse } from 'next/server'
import {
  exchangeCodeForTokens,
  getRedirectUri,
  safeStringEqual,
  verifyIdToken,
  type TokenBundle,
} from '../../../lib/customer-account'
import {
  clearOAuthFlowCookies,
  readOAuthFlowCookies,
  setSessionCookies,
} from '../../../lib/customer-session'

// Node runtime — node:crypto for safeStringEqual + jose for JWT verify.
export const runtime = 'nodejs'

// GET /auth/customer/callback?code=…&state=…
//
// Final leg of the Shopify Customer Account API OAuth flow. Validates the
// state cookie (CSRF), swaps the code for tokens (Basic-auth POST to the
// discovered token endpoint), verifies the ID token JWT signature against
// the discovered JWKS plus its nonce/issuer/audience claims, then writes
// the four cust_* session cookies and redirects to the path the user was
// on when they clicked log in.
//
// On any failure the user is bounced to /?login_error=<code> so we never
// leak a half-set session and the front end can render an inline error.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')
  const oauthErrorDescription = url.searchParams.get('error_description')

  // Shopify itself reported an error during consent — user denied, scope
  // rejected, etc. Surface the upstream code rather than masking it.
  if (oauthError) {
    console.error(
      `[customer/callback] Shopify returned error: ${oauthError}`,
      oauthErrorDescription,
    )
    return loginErrorRedirect(request, oauthError, oauthErrorDescription)
  }

  if (!code || !state) {
    return loginErrorRedirect(request, 'missing_params', 'Login response missing code or state')
  }

  const flow = readOAuthFlowCookies(request)
  if (!flow.state || !flow.nonce) {
    return loginErrorRedirect(
      request,
      'missing_flow_cookies',
      'Login flow expired or cookies were blocked',
    )
  }

  if (!safeStringEqual(state, flow.state)) {
    return loginErrorRedirect(request, 'state_mismatch', 'Login flow CSRF check failed')
  }

  let bundle: TokenBundle
  try {
    bundle = await exchangeCodeForTokens(code, getRedirectUri())
  } catch (err) {
    console.error('[customer/callback] token exchange failed:', err)
    return loginErrorRedirect(request, 'token_exchange_failed', 'Could not complete login')
  }

  try {
    await verifyIdToken(bundle.idToken, flow.nonce)
  } catch (err) {
    console.error('[customer/callback] ID token verification failed:', err)
    return loginErrorRedirect(request, 'id_token_invalid', 'Login response invalid')
  }

  // Same-origin redirect. flow.returnTo was already validated as a
  // leading-slash path when /api/customer/login wrote the cookie.
  const returnTo = flow.returnTo && flow.returnTo.startsWith('/') ? flow.returnTo : '/'
  const target = new URL(returnTo, getAppOrigin(request))
  const response = NextResponse.redirect(target)

  setSessionCookies(response, bundle)
  clearOAuthFlowCookies(response)
  return response
}

function getAppOrigin(request: NextRequest): string {
  // Prefer NEXT_PUBLIC_APP_URL (matches what's registered in Shopify) over
  // request.url, which can drift if a proxy header is missing or wrong.
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}

function loginErrorRedirect(
  request: NextRequest,
  errorCode: string,
  description: string | null | undefined,
): NextResponse {
  const target = new URL('/', getAppOrigin(request))
  target.searchParams.set('login_error', errorCode)
  if (description) target.searchParams.set('login_error_description', description)
  return NextResponse.redirect(target)
}
