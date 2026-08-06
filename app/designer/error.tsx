'use client'
// Designer route error boundary — catches render crashes in the designer so a Fabric/canvas
// failure shows a recover path, never a white screen.
//
// Recovery is "Reload & restore," NOT an in-place reset (Denise, 2026-08-06). The designer keeps a
// per-tab auto-draft of the in-progress design (sessionStorage, see app/lib/autodraft.ts), but that
// snapshot is only restored on a genuine RELOAD — a React error-boundary reset() re-mounts without a
// reload, so it would NOT restore the work (and the mount path clears the snapshot on a non-reload).
// So the primary action reloads: nav type = 'reload' → the designer restores the auto-draft → the
// customer's in-progress design comes right back.
import { useEffect } from 'react'
import ErrorFallback from '../components/ErrorFallback'

export default function DesignerError({
  error,
}: {
  error: Error & { digest?: string }
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
          <strong className="font-semibold text-white/90">Your in-progress design was saved in this browser</strong>
          {' '}&mdash; reload to bring it right back.
        </>
      }
      digest={error.digest}
      actions={[
        { label: 'Reload & restore my design', onClick: () => window.location.reload(), primary: true },
        { label: 'Back to shop', onClick: () => { window.location.href = '/' } },
      ]}
    />
  )
}
