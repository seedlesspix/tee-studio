'use client'
// App-level error boundary — the net under every route that doesn't have its own error.tsx
// (home, admin, etc.). Render crashes show a recover path instead of a white screen.
import { useEffect } from 'react'
import ErrorFallback from './components/ErrorFallback'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app] render error:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Something went wrong"
      message={
        <>
          An unexpected error occurred.{' '}
          <strong className="font-semibold text-white/90">Your saved work is safe.</strong>{' '}
          Try again, or head back home.
        </>
      }
      digest={error.digest}
      actions={[
        { label: 'Try again', onClick: () => reset(), primary: true },
        { label: 'Home', onClick: () => { window.location.href = '/' } },
      ]}
    />
  )
}
