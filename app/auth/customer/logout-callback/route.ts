import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookies } from '../../../lib/customer-session'

export const runtime = 'nodejs'

// GET /auth/customer/logout-callback
//
// Shopify redirects here after the OIDC end_session flow completes. Our
// cust_* cookies were already cleared by /api/customer/logout; we clear
// them again defensively in case the browser landed here without going
// through our own route (e.g., a bookmarked URL).
//
// If /api/customer/logout stashed a `cust_logout_return_to` cookie (the page
// the customer logged out from, e.g. the designer), we redirect back there so
// logout preserves context the same way login does. Otherwise we send the
// user home. The cookie is validated again and cleared here.
export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request)

  const returnTo = request.cookies.get('cust_logout_return_to')?.value ?? ''
  const safeReturnTo =
    returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : ''

  const destination = safeReturnTo ? `${appOrigin}${safeReturnTo}` : appOrigin
  const response = NextResponse.redirect(destination)
  clearSessionCookies(response)
  response.cookies.set('cust_logout_return_to', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

function getAppOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}
