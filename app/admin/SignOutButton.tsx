'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase/browser'

export default function SignOutButton() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSignOut = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin-login')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wide bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-50"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
