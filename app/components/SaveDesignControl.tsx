'use client'
import { useEffect, useRef, useState } from 'react'

// "Save design" button + its feedback.
//
// Logged in: the design lands in My Designs on any device, so a quiet "Saved ✓"
// is enough. Logged out: the link IS the customer's only handle on the design,
// so we surface it to copy, plus a nudge to log in (which adopts the design into
// their account — see adoptSessionRows).

type Props = {
  onSave: () => Promise<{ restoreUrl: string } | null>
  loggedIn: boolean
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

export default function SaveDesignControl({ onSave, loggedIn }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [restoreUrl, setRestoreUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Logged-in "Saved ✓" reverts on its own; the logged-out panel stays until
  // dismissed so the link can't vanish before it's copied.
  useEffect(() => {
    if (status !== 'saved' || !loggedIn) return
    const t = setTimeout(() => setStatus('idle'), 2500)
    return () => clearTimeout(t)
  }, [status, loggedIn])

  useEffect(() => {
    if (!restoreUrl) return
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setRestoreUrl(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [restoreUrl])

  const handleSave = async () => {
    setStatus('saving')
    setCopied(false)
    try {
      const result = await onSave()
      if (!result) { setStatus('error'); setTimeout(() => setStatus('idle'), 3000); return }
      setStatus('saved')
      if (!loggedIn) setRestoreUrl(result.restoreUrl)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const copy = async () => {
    if (!restoreUrl) return
    try {
      await navigator.clipboard.writeText(restoreUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked — the input is selectable as a fallback.
    }
  }

  const text =
    status === 'saving' ? 'Saving…' :
    status === 'saved' ? 'Saved ✓' :
    status === 'error' ? 'Try again' :
    'Save design'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={handleSave}
        disabled={status === 'saving'}
        className={`px-3 py-1.5 rounded text-sm border transition-colors ${
          status === 'saved'
            ? 'border-green-600 text-green-700 bg-green-50'
            : status === 'error'
              ? 'border-[#dd3333] text-[#dd3333] bg-red-50'
              : 'border-gray-300 text-gray-800 hover:border-[#dd3333] hover:text-[#dd3333]'
        }`}
      >
        {text}
      </button>

      {restoreUrl && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-xl p-4 z-50">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">Design saved</p>
            <button
              onClick={() => setRestoreUrl(null)}
              aria-label="Dismiss"
              className="text-gray-400 hover:text-gray-700 text-xs leading-none mt-1"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            Keep this link to come back to your design later:
          </p>
          <div className="flex gap-1.5 mt-2">
            <input
              readOnly
              value={restoreUrl}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-[11px] text-gray-700 font-mono outline-none focus:border-[#dd3333]"
            />
            <button
              onClick={copy}
              className="px-2.5 py-1.5 rounded text-xs font-semibold bg-[#dd3333] text-white hover:bg-red-700 transition-colors whitespace-nowrap"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-3 pt-3 border-t border-gray-100 leading-relaxed">
            Or <span className="font-semibold text-gray-700">log in</span> and we&rsquo;ll keep it in your
            account — no link to hang on to.
          </p>
        </div>
      )}
    </div>
  )
}
