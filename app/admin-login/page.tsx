'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../lib/supabase/browser'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/admin/clipart'

  const handleSendCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setStep('code')
    }
  }

  const handleVerifyCode = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push(from)
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-mono font-bold text-[#e8ff47] mb-1">Admin Access</h1>
        <p className="text-gray-500 text-xs font-mono mb-6">T-Shirt Deli Designer Admin</p>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
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
              {loading ? 'Sending...' : 'Send sign-in code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <p className="text-sm font-mono text-gray-300">
              Code sent to <span className="text-white">{email}</span>
            </p>
            <div>
              <label className="text-xs font-mono text-gray-500 uppercase tracking-widest block mb-1">6-digit code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                required
                className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-2xl text-white outline-none focus:border-[#e8ff47] font-mono tracking-[0.5em] text-center"
              />
            </div>
            {error && <p className="text-red-400 text-xs font-mono">{error}</p>}
            <button type="submit" disabled={loading || code.length !== 6}
              className="w-full py-2.5 rounded bg-[#e8ff47] text-black font-mono font-bold text-sm hover:bg-yellow-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <button type="button"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="text-xs underline text-gray-500 hover:text-gray-300 self-start">
              Use a different email
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
