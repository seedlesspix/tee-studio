'use client'
// Root/global error boundary — the LAST resort, catches errors thrown in the root layout itself
// (where app/error.tsx can't reach). It replaces the whole document, so it must render its own
// <html>/<body> and CANNOT rely on the app's CSS — hence inline styles. Kept deliberately minimal.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0d0d0d', color: '#fff', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
            <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'rgba(255,255,255,0.7)' }}>
              The app ran into an unexpected error. Your saved designs are safe. Please reload to continue.
            </p>
            <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => reset()}
                style={{ background: '#dd3333', color: '#fff', border: 0, borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >
                Try again
              </button>
              <button
                onClick={() => { window.location.href = '/' }}
                style={{ background: 'transparent', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
              >
                Home
              </button>
            </div>
            {error?.digest && (
              <p style={{ marginTop: 22, fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Reference: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
