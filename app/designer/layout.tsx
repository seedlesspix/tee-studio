import type { Viewport } from 'next'

// Designer-scoped viewport. Mobile browsers may PINCH-ZOOM the designer (Denise
// 2026-08-09 — customers zoom in to inspect their design; Android needs this since
// Chrome honours maximum-scale/user-scalable, unlike iOS which ignores them for user
// pinch). So we deliberately do NOT set maximum-scale / user-scalable. The only reason
// they were here was to suppress iOS auto-zoom-on-focus for inputs < 16px — that is now
// prevented at the source by forcing every designer input to >= 16px (globals.css,
// `.designer-mobile-shell input/textarea/select`), which stops the auto-zoom WITHOUT
// taking zoom away from the customer. Server component (the page is a client component
// and can't export viewport).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function DesignerLayout({ children }: { children: React.ReactNode }) {
  return children
}
