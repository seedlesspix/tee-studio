// Best-effort in-memory rate limiter + origin/IP helpers for Vercel serverless routes.
//
// ⚠️ SCOPE: module-scoped state persists across invocations on a WARM instance, but it is
//    PER-INSTANCE (not shared across Vercel's fleet) and resets on cold start. This is a pre-launch
//    abuse MITIGATION, not a fortress — enough to stop our own UI from looping, casual curl, and a
//    single hot instance being hammered. The durable cross-instance version (a Supabase counter
//    table or Upstash Redis) is the launch-hardening follow-up; this module's API can back onto it
//    unchanged. IP keys are best-effort (x-forwarded-for is client-spoofable) — the global ceiling
//    is the backstop that doesn't depend on honest IPs.

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
let lastSweep = 0

// Evict expired buckets so the map can't grow unbounded. Throttled to once/minute (O(n) scan).
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
}

export type RateResult = { ok: boolean; retryAfterSec: number; remaining: number }

// Fixed-window counter: `limit` hits per `windowMs`. Not sliding — good enough for abuse control
// and cheap. Returns ok=false with Retry-After seconds once the window is saturated.
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateResult {
  sweep(now)
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSec: 0, remaining: Math.max(0, limit - 1) }
  }
  if (b.count >= limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)), remaining: 0 }
  b.count++
  return { ok: true, retryAfterSec: 0, remaining: Math.max(0, limit - b.count) }
}

// Client IP as seen by Vercel's edge. x-real-ip is Vercel-set (harder to spoof than x-forwarded-for,
// whose leftmost entry the client can forge). Best-effort — pair with a global ceiling.
export function clientIp(headers: Headers): string {
  return (headers.get('x-real-ip') || headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim() || 'unknown'
}

// Same-site guard: a cross-origin browser POST always carries Origin, so an off-site page can't
// drive this endpoint. Same-origin clients (and non-browser callers) may omit Origin — allowed here,
// since the rate limit + global ceiling still bound them. Rejects only a PRESENT, non-allowlisted origin.
export function originAllowed(headers: Headers): boolean {
  const origin = headers.get('origin')
  if (!origin) return true
  let host: string
  try { host = new URL(origin).host } catch { return false }
  const appHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_APP_URL || '').host } catch { return '' } })()
  const allow = new Set([appHost, 'create.tshirtdeli.com', 'tshirtdeli.com', 'www.tshirtdeli.com', 'localhost:3000', '127.0.0.1:3000'].filter(Boolean))
  return allow.has(host) || host.endsWith('.vercel.app') // Vercel preview deployments
}
