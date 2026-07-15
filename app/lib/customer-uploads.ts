// Server-only helpers for the "My Uploads" library. Uses the Supabase
// service-role key, so this module must never be imported into a client
// component — only route handlers / the OAuth callback import it.
//
// The customer_uploads table has RLS enabled with NO policies, so all access
// flows through the service role here. Ownership is derived server-side (never
// from a client-supplied id): a verified Shopify customer id, or an anonymous
// HttpOnly session id. See the read-policy design in CLAUDE.md (Phase 3 Day 7).
import type { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyIdTokenNoNonce } from './customer-account'
import type { Database } from '@/types/database'

// The anonymous session cookie. HttpOnly so JS can never read it — the browser
// never names an owner, which is what makes "no path to another session's rows"
// literally true.
export const UPLOAD_SESSION_COOKIE = 'tee_session'
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
// tampered/non-uuid cookie value (the column is uuid).
export function getSessionId(request: NextRequest): string | null {
  const raw = request.cookies.get(UPLOAD_SESSION_COOKIE)?.value
  return raw && UUID_RE.test(raw) ? raw : null
}

// Reusable login-adoption step: stamp the customer id onto the anonymous
// session's rows so a guest's uploads follow them into their account. Only
// touches rows not already owned by a customer. Day 8 (My Designs) reuses this
// exact pattern on design_orders — keep it generic in spirit.
export async function adoptSessionUploads(sessionId: string, customerId: string): Promise<void> {
  if (!sessionId || !UUID_RE.test(sessionId) || !customerId) return
  const supabase = serviceClient()
  const { error } = await supabase
    .from('customer_uploads')
    .update({ shopify_customer_id: customerId })
    .eq('session_id', sessionId)
    .is('shopify_customer_id', null)
  if (error) console.error('[uploads] adopt-on-login failed:', error)
}
