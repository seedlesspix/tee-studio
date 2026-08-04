'use client'
// Designer route error boundary — catches render crashes in the designer so a Fabric/canvas
// failure shows a recover path, never a white screen. "Try again" (reset) re-renders in place;
// "Reload" re-fetches and restores the last SAVED version (draft / My Designs).
import { useEffect } from 'react'
import ErrorFallback from '../components/ErrorFallback'

export default function DesignerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[designer] render error:', error)
  }, [error])

  return (
    <ErrorFallback
      title="Something went wrong"
      message={
        <>
          The designer ran into an unexpected problem.{' '}
          <strong className="font-semibold text-white/90">Your saved designs are safe.</strong>{' '}
          Try again to pick up where you left off, or reload to restore your last saved version.
        </>
      }
      digest={error.digest}
      actions={[
        { label: 'Try again', onClick: () => reset(), primary: true },
        { label: 'Reload', onClick: () => window.location.reload() },
        { label: 'Back to shop', onClick: () => { window.location.href = '/' } },
      ]}
    />
  )
}
