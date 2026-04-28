'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/admin/clipart'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push(from)
      router.refresh()
    } else {
      setError('Incorrect password')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-mono font-bold text-[#e8ff47] mb-1">Admin Access</h1>
        <p className="text-gray-500 text-xs font-mono mb-6">T-Shirt Deli Designer Admin</p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-mono text-gray-500 uppercase tracking-widest block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              autoFocus
              className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#e8ff47] font-mono"
            />
          </div>
          {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
          <button type="submit" disabled={loading || !password}
            className="w-full py-2.5 rounded bg-[#e8ff47] text-black font-mono font-bold text-sm hover:bg-yellow-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Checking...' : 'Enter Admin'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>
}
