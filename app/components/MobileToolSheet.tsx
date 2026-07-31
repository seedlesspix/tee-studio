'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Rail from './Rail'

// MobileToolSheet — BLOCKER-2 pass 3. A hand-built bottom sheet (peek / half /
// full) that brings the tools to mobile: a horizontal Rail tab bar + the shared
// SelectionPanel (passed as children). `lg:hidden` — desktop never renders it;
// the desktop left aside owns the (single) SelectionPanel instead.
//
// Drag the handle to move between snaps; on release it snaps to the nearest.
// Pointer events + setPointerCapture cover touch and mouse. The sheet sits on the
// fixed app-viewport (root overflow/overscroll lock) so the swipe isn't eaten by
// the browser; the handle is touch-action:none, the body scrolls (overscroll
// contained so it doesn't chain to the page).
type Snap = 'peek' | 'half' | 'full'
type Tab = 'text' | 'upload' | 'clipart'

export default function MobileToolSheet({
  snap,
  setSnap,
  activeTab,
  onSelectTab,
  children,
}: {
  snap: Snap
  setSnap: (s: Snap) => void
  activeTab: string
  onSelectTab: (tab: Tab) => void
  children: ReactNode
}) {
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  useEffect(() => {
    const update = () => setVh(window.innerHeight)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const PEEK_PX = 132 // handle + tab bar visible at peek
  const sheetH = Math.round(vh * 0.9)
  const visibleFor = (s: Snap) => (s === 'peek' ? PEEK_PX : s === 'half' ? Math.round(vh * 0.5) : sheetH)
  const translateFor = (s: Snap) => sheetH - visibleFor(s)

  const [drag, setDrag] = useState<number | null>(null) // live translateY while dragging
  const startRef = useRef<{ y: number; t: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    startRef.current = { y: e.clientY, t: translateFor(snap) }
    setDrag(translateFor(snap))
  }
  const onMove = (e: React.PointerEvent) => {
    const s = startRef.current
    if (!s) return
    const next = s.t + (e.clientY - s.y)
    setDrag(Math.max(0, Math.min(next, translateFor('peek'))))
  }
  const onUp = () => {
    if (drag != null) {
      let best: Snap = 'peek'
      let bestD = Infinity
      for (const s of ['full', 'half', 'peek'] as Snap[]) {
        const d = Math.abs(translateFor(s) - drag)
        if (d < bestD) { bestD = d; best = s }
      }
      setSnap(best)
    }
    setDrag(null)
    startRef.current = null
  }

  const translateY = drag ?? translateFor(snap)

  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.14)]"
      style={{
        height: sheetH,
        transform: `translateY(${translateY}px)`,
        transition: drag == null ? 'transform 0.25s ease' : 'none',
      }}
    >
      {/* Drag handle */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="flex shrink-0 cursor-grab items-center justify-center py-3"
        style={{ touchAction: 'none' }}
        role="button"
        aria-label="Drag to resize tools"
      >
        <div className="h-1.5 w-10 rounded-full bg-gray-300" />
      </div>
      <Rail orientation="horizontal" activeTab={activeTab} onSelectTab={onSelectTab} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  )
}
