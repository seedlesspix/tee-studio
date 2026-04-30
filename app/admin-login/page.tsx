'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '../lib/supabase/browser'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/admin/clipart'

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(from)}`

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-mono font-bold text-[#e8ff47] mb-1">Admin Access</h1>
        <p className="text-gray-500 text-xs font-mono mb-6">T-Shirt Deli Designer Admin</p>

        {sent ? (
          <div className="text-sm font-mono text-gray-300 space-y-3">
            <p className="text-[#e8ff47]">Check your inbox.</p>
            <p>We sent a sign-in link to <span className="text-white">{email}</span>.</p>
            <p className="text-gray-500 text-xs">The link expires in 1 hour. If you don&apos;t see it, check spam.</p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="text-xs underline text-gray-500 hover:text-gray-300"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-mono text-gray-500 uppercase tracking-widest block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
                className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#e8ff47] font-mono"
              />
            </div>
            {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
            <button type="submit" disabled={loading || !email}
              className="w-full py-2.5 rounded bg-[#e8ff47] text-black font-mono font-bold text-sm hover:bg-yellow-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Sending...' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
