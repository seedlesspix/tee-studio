import { NextRequest, NextResponse } from 'next/server'
import { getDiscovery } from '../../../lib/customer-account'
import { clearSessionCookies } from '../../../lib/customer-session'

export const runtime = 'nodejs'

// POST /api/customer/logout?return_to=<path>
//
// Clears our local cust_* session cookies, then redirects the browser to
// Shopify's OIDC end_session_endpoint so the customer is also signed out at
// account.tshirtdeli.com. Shopify redirects back to our
// /auth/customer/logout-callback, which does the final redirect to the app.
//
// `return_to` (a same-origin path, e.g. the designer URL the customer logged
// out from) is stashed in a short-lived HttpOnly cookie so the round-trip
// through Shopify can preserve it. We don't append it to
// post_logout_redirect_uri because Shopify validates that URI against its
// registered logout redirects — a query string there risks a mismatch.
//
// Also exposed as GET so a plain link works (the logout menu item is a GET
// link). The behavior is identical.
export async function POST(request: NextRequest) {
  return handleLogout(request)
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}

async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const idTokenHint = request.cookies.get('cust_id_token')?.value

  // Open-redirect guard: only same-origin paths are allowed. Reject absolute
  // URLs and protocol-relative `//evil.com` variants. Mirrors /api/customer/login.
  const returnToParam = new URL(request.url).searchParams.get('return_to') ?? ''
  const safeReturnTo =
    returnToParam.startsWith('/') && !returnToParam.startsWith('//')
      ? returnToParam
      : ''

  const appOrigin = getAppOrigin(request)
  const postLogoutRedirectUri = `${appOrigin}/auth/customer/logout-callback`

  let redirectTarget: string
  try {
    const { end_session_endpoint } = await getDiscovery()
    const url = new URL(end_session_endpoint)
    if (idTokenHint) {
      // id_token_hint tells Shopify which session to end. Without it Shopify
      // may prompt the user or refuse to redirect back.
      url.searchParams.set('id_token_hint', idTokenHint)
    }
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
    redirectTarget = url.toString()
  } catch (err) {
    // If discovery is unreachable we still want to clear our local session
    // rather than leave the user with a stale cookie set.
    console.error('[customer/logout] discovery failed, doing local-only logout:', err)
    redirectTarget = postLogoutRedirectUri
  }

  // 303 See Other (not the default 307) so the browser switches to GET when
  // following the redirect. Shopify's end_session_endpoint only accepts GET;
  // a 307 would preserve the incoming POST and Shopify returns "Method not
  // supported". 303 is also the correct semantics for POST-then-redirect.
  const response = NextResponse.redirect(redirectTarget, 303)
  clearSessionCookies(response)

  // Carry the post-logout return path across the Shopify round-trip in a
  // short-lived HttpOnly cookie. /auth/customer/logout-callback reads and
  // clears it. Absent → callback falls back to the homepage.
  if (safeReturnTo) {
    response.cookies.set('cust_logout_return_to', safeReturnTo, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })
  }

  return response
}

function getAppOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}
