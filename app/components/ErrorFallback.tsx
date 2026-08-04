'use client'
// Shared, branded crash fallback (customer-facing dark surface). Used by the route error
// boundaries (app/error.tsx, app/designer/error.tsx, app/order/error.tsx) so a render crash
// NEVER shows a white screen — always a friendly "something went wrong" + a recover path.
import type { ReactNode } from 'react'

export type ErrorAction = { label: string; onClick: () => void; primary?: boolean }

export default function ErrorFallback({
  title = 'Something went wrong',
  message,
  actions,
  digest,
}: {
  title?: string
  message: ReactNode
  actions: ErrorAction[]
  digest?: string
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0d0d0d] px-6 py-12 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#1e1e1e] ring-1 ring-white/10">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#dd3333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/70">{message}</p>
        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={
                a.primary
                  ? 'rounded-lg bg-[#dd3333] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#c62828]'
                  : 'rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/5'
              }
            >
              {a.label}
            </button>
          ))}
        </div>
        {digest && <p className="mt-6 font-mono text-[11px] text-white/30">Reference: {digest}</p>}
      </div>
    </div>
  )
}
