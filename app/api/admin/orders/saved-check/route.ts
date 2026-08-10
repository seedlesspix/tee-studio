// Admin pre-delete check: do any of these design_orders rows back a customer's "My Designs" saved
// entry? design_orders → saved_designs is ON DELETE CASCADE, so deleting such a row silently destroys
// the customer's saved work. saved_designs has RLS with NO policies (service-role only), so the admin
// UI can't read it directly — this route (admin-gated, service role) returns the count so the delete
// confirm can warn specifically instead of generically.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { serviceClient } from '../../../../lib/customer-library'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { data: isAdmin } = await sb.rpc('is_admin')
  if (!user?.email || !isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ids?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  if (!ids.length) return NextResponse.json({ savedCount: 0 })

  const { count, error } = await serviceClient()
    .from('saved_designs')
    .select('id', { count: 'exact', head: true })
    .in('design_order_id', ids)
  if (error) return NextResponse.json({ error: 'check failed' }, { status: 500 })
  return NextResponse.json({ savedCount: count ?? 0 })
}
