// Owner-only admin management (BETA #23). Adds an email to the `admins` allowlist
// AND pre-creates their Supabase auth account so their FIRST OTP sign-in works.
//
// 🐛 THE BUG THIS FIXES: the admin login calls signInWithOtp({ shouldCreateUser:
// false }) — a deliberate anti-signup guard. So an email that has never signed in
// has no auth.users row, and the code request fails with "Signups not allowed for
// otp". A freshly-added admin could therefore never get in. We keep the guard
// (no arbitrary self-signup) and instead pre-create the account here, at add time,
// gated behind the owner. createUser sends NO email (unlike inviteUserByEmail) —
// the new admin gets their code when they actually sign in.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { serviceClient } from '../../../lib/customer-library'

export const runtime = 'nodejs' // service-role admin API isn't available on edge

export async function POST(req: NextRequest) {
  // 1. OWNER gate — same session cookie as /admin; only the owner manages the list.
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: isOwner } = await sb.rpc('is_admin_owner')
  if (!user?.email || !isOwner) {
    return NextResponse.json({ error: 'Only the account owner can add admins.' }, { status: 403 })
  }

  let body: { email?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const email = (body.email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const svc = serviceClient()

  // 2. Add to the allowlist (service role; the owner gate above is the real guard).
  const { error: insErr } = await svc
    .from('admins')
    .insert({ email, is_owner: false, added_by: user.email.toLowerCase() })
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') { // unique_violation
      return NextResponse.json({ error: 'That email is already an admin.' }, { status: 409 })
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // 3. Pre-create their auth account so first-time OTP sign-in works. If the account
  //    already exists (re-adding someone previously removed), that's fine — their
  //    account is ready. Any OTHER failure rolls back the allowlist row so we never
  //    leave an "admin" who can't actually sign in.
  const { error: authErr } = await svc.auth.admin.createUser({ email, email_confirm: true })
  if (authErr) {
    const msg = (authErr.message || '').toLowerCase()
    const alreadyExists =
      msg.includes('already been registered') ||
      msg.includes('already registered') ||
      msg.includes('already exists') ||
      (authErr as { status?: number }).status === 422
    if (!alreadyExists) {
      await svc.from('admins').delete().eq('email', email)
      return NextResponse.json(
        { error: 'Could not create the sign-in account: ' + authErr.message },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ ok: true })
}
