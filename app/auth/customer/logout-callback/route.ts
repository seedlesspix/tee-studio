import { NextRequest, NextResponse } from 'next/server'
import { clearSessionCookies } from '../../../lib/customer-session'

export const runtime = 'nodejs'

// GET /auth/customer/logout-callback
//
// Shopify redirects here after the OIDC end_session flow completes. Our
// cust_* cookies were already cleared by /api/customer/logout; we clear
// them again defensively in case the browser landed here without going
// through our own route (e.g., a bookmarked URL), then send the user home.
export async function GET(request: NextRequest) {
  const appOrigin = getAppOrigin(request)
  const response = NextResponse.redirect(appOrigin)
  clearSessionCookies(response)
  return response
}

function getAppOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  return new URL(request.url).origin
}
