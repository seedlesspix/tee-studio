'use client'
// Order-page error boundary — a crash here shows a recover path, never a white screen.
import { useEffect } from 'react'
import ErrorFallback from '../components/ErrorFallback'

export default function OrderError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[order] render error:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Something went wrong"
      message={
        <>
          We hit a problem loading your order summary.{' '}
          <strong className="font-semibold text-white/90">Your design is safe.</strong>{' '}
          Try again, or head back to the designer.
        </>
      }
      digest={error.digest}
      actions={[
        { label: 'Try again', onClick: () => reset(), primary: true },
        { label: 'Back to designer', onClick: () => { window.history.length > 1 ? window.history.back() : (window.location.href = '/designer') } },
      ]}
    />
  )
}
