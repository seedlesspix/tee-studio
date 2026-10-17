'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Is the person using the designer a signed-in ADMIN? Customers sign in through Shopify (the cust_* cookies)
// and never hold a Supabase session, so "has a Supabase session AND is_admin() says yes" means staff.
// Same check the /admin layout makes (the admins list, via the is_admin() function). UI gating only — what
// it unlocks (e.g. Download PNG) runs entirely in the browser, so there is nothing to protect server-side.
export function useAdminSession(): { isAdmin: boolean } {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) { if (alive) setIsAdmin(false); return }
        const { data } = await supabase.rpc('is_admin')
        if (alive) setIsAdmin(data === true)
      } catch {
        if (alive) setIsAdmin(false)
      }
    }
    void check()
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void check() })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])
  return { isAdmin }
}
