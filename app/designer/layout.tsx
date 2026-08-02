import type { Viewport } from 'next'

// Designer-scoped viewport. iOS auto-zooms when you focus any input with
// font-size < 16px (our text box is 14px), and because the designer locks the
// document (body position:fixed for the mobile canvas), that zoom-pan doesn't
// cleanly reset — it left the shirt shifted right after the keyboard closed.
// maximum-scale=1 stops the auto-zoom entirely. Scoped to /designer via this
// layout so admin/order pages keep normal pinch-zoom. The designer has its own
// zoom control, so disabling browser zoom here is acceptable. Server component
// (the page is a client component and can't export viewport).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function DesignerLayout({ children }: { children: React.ReactNode }) {
  return children
}
