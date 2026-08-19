'use client'
import { useState, Suspense, type FormEventHandler } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '../lib/supabase/browser'
import BrandMark from '../components/BrandMark'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/admin/orders'

  const handleSendCode: FormEventHandler<HTMLFormElement> = async (e) => {
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

  const handleVerifyCode: FormEventHandler<HTMLFormElement> = async (e) => {
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
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-xl p-8 w-full max-w-sm shadow-sm">
        <div className="mb-6">
          <span className="font-black text-lg tracking-widest text-black">
            <BrandMark />
            <span className="text-gray-500 font-mono text-xs ml-2">/ ADMIN</span>
          </span>
        </div>
        <h1 className="text-xl font-mono font-bold text-black mb-1">Admin Access</h1>
        <p className="text-gray-600 text-xs font-mono mb-6">T-Shirt Deli Designer Admin</p>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-mono text-gray-600 uppercase tracking-widest block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
                className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-sm text-black outline-none focus:border-[#dd3333] font-mono placeholder-gray-400"
              />
            </div>
            {error && <p className="text-red-600 text-xs font-mono">{error}</p>}
            <button type="submit" disabled={loading || !email}
              className="w-full py-2.5 rounded bg-[#dd3333] text-white font-mono font-bold text-sm hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Sending...' : 'Send sign-in code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <p className="text-sm font-mono text-black">
              Code sent to <span className="font-bold">{email}</span>
            </p>
            <div>
              <label className="text-xs font-mono text-gray-600 uppercase tracking-widest block mb-1">Sign-in code</label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="00000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={8}
                required
                className="w-full bg-white border border-gray-300 rounded px-3 py-2 text-2xl text-black outline-none focus:border-[#dd3333] font-mono tracking-[0.4em] text-center placeholder-gray-300"
              />
            </div>
            {error && <p className="text-red-600 text-xs font-mono">{error}</p>}
            <button type="submit" disabled={loading || code.length < 6}
              className="w-full py-2.5 rounded bg-[#dd3333] text-white font-mono font-bold text-sm hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <button type="button"
              onClick={() => { setStep('email'); setCode(''); setError('') }}
              className="text-xs underline text-gray-600 hover:text-black self-start">
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
