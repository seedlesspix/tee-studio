import { NextRequest, NextResponse } from 'next/server'
import { getDiscovery } from '../../../lib/customer-account'
import { clearSessionCookies } from '../../../lib/customer-session'

export const runtime = 'nodejs'

// POST /api/customer/logout
//
// Clears our local cust_* session cookies, then redirects the browser to
// Shopify's OIDC end_session_endpoint so the customer is also signed out at
// account.tshirtdeli.com. Shopify redirects back to our
// /auth/customer/logout-callback with no state to clean up on our side.
//
// Also exposed as GET so a plain link works if we ever wire this up outside
// a form. The behavior is identical.
export async function POST(request: NextRequest) {
  return handleLogout(request)
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}

async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const idTokenHint = request.cookies.get('cust_id_token')?.value

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

  const response = NextResponse.redirect(redirectTarget)
  clearSessionCookies(response)
  return response
}

function getAppOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}
