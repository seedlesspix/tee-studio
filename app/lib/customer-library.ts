// Server-only ownership helpers shared by the customer's two libraries:
// "My Uploads" (customer_uploads → Cloudinary files) and "My Designs"
// (saved_designs → design_orders rows). Uses the Supabase service-role key, so
// this module must never be imported into a client component — only route
// handlers and the OAuth callback import it.
//
// Both tables have RLS enabled with NO policies, so every read/write flows
// through the service role here and ownership is derived server-side, never from
// a client-supplied id: a verified Shopify customer id, or an anonymous HttpOnly
// session id. Customers authenticate to Shopify (not Supabase), so the database
// has no trusted view of their identity and RLS cannot scope these reads — see
// the read-policy design in CLAUDE.md (Phase 3 Day 7).
import type { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyIdTokenNoNonce } from './customer-account'
import type { Database } from '@/types/database'

// The anonymous session cookie. HttpOnly so page JS can never read it — the
// browser never names an owner, which is what makes "no path to another
// session's rows" literally true.
//
// NOTE: the cookie name is load-bearing — it shipped in Day 7 and live browsers
// already hold it. Don't change the value.
export const SESSION_COOKIE = 'tee_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180 // 180 days

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function serviceClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service credentials are not configured')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

// Verified Shopify customer id from the ID-token cookie, or null. Network-free
// after the first JWKS fetch (the same verification /api/customer/me uses). An
// expired or invalid token yields null and the caller falls back to the
// anonymous session — consistent with the ~1h "ghost logged-in" bound already
// documented for /api/customer/me.
export async function getCustomerId(request: NextRequest): Promise<string | null> {
  const idToken = request.cookies.get('cust_id_token')?.value
  if (!idToken) return null
  try {
    const claims = await verifyIdTokenNoNonce(idToken)
    return claims.sub ? String(claims.sub) : null
  } catch {
    return null
  }
}

// A validated anonymous session id from the cookie, or null. Guards against a
// tampered/non-uuid cookie value (the columns are uuid).
export function getSessionId(request: NextRequest): string | null {
  const raw = request.cookies.get(SESSION_COOKIE)?.value
  return raw && UUID_RE.test(raw) ? raw : null
}

// Get the caller's anonymous session id, minting one if this browser has none.
// `isNew` tells the caller to write the cookie onto its response.
//
// Both write paths (POST /api/uploads and POST /api/designs) use this. Day 7
// only ever minted the cookie on upload, so a customer who saved a design
// without uploading first would have had no session to own it.
export function getOrCreateSessionId(request: NextRequest): { sessionId: string; isNew: boolean } {
  const existing = getSessionId(request)
  if (existing) return { sessionId: existing, isNew: false }
  return { sessionId: crypto.randomUUID(), isNew: true }
}

export function setSessionCookie(response: NextResponse, sessionId: string): void {
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
}

// Login-adoption step: stamp the customer id onto everything this browser's
// anonymous session owns, so a guest's uploads AND saved designs follow them
// into their account. Only touches rows not already owned by a customer.
//
// Called from the Shopify OAuth callback. Best-effort by design: the two tables
// are independent and errors are swallowed so a failure here can never block
// login.
export async function adoptSessionRows(sessionId: string, customerId: string): Promise<void> {
  if (!sessionId || !UUID_RE.test(sessionId) || !customerId) return
  const supabase = serviceClient()

  const uploads = await supabase
    .from('customer_uploads')
    .update({ shopify_customer_id: customerId })
    .eq('session_id', sessionId)
    .is('shopify_customer_id', null)
  if (uploads.error) console.error('[adopt] customer_uploads failed:', uploads.error)

  const designs = await supabase
    .from('saved_designs')
    .update({ shopify_customer_id: customerId })
    .eq('session_id', sessionId)
    .is('shopify_customer_id', null)
  if (designs.error) console.error('[adopt] saved_designs failed:', designs.error)
}
