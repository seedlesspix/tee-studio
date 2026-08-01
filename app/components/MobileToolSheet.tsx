'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import Rail from './Rail'

// MobileToolSheet — BLOCKER-2 pass 3 (v3, native). A tap-driven PARTIAL bottom
// overlay that brings the tools to mobile: a horizontal Rail tab bar (always
// peeking) + the shared SelectionPanel (children) in one native-scroll region.
// Only mounted when the parent is in mobile mode — desktop never renders it (the
// desktop left aside owns the single SelectionPanel), so desktop stays identical.
//
// WHY NO DRAG LIBRARY. v1 hand-built pointer-drag didn't register on a real
// phone; v2 used vaul but its drag/scroll were EATEN by iOS/WebKit — vaul sets
// `touch-action: none` on its content (so the inner list, a descendant, can't get
// native scroll) and its JS drag is torn down by pointercancel from the fixed-body
// overscroll engine. Denise's new spec dropped drag-to-resize, so v3 removes the
// library entirely: the sheet just slides between two states via a CSS transform
// (tap-driven), and the options scroll with a plain native `overflow-y-auto`
// region. Nothing intercepts touchmove, so WebKit gives momentum scroll for free.
//
// The two load-bearing details (either one missing reproduces "won't scroll"):
//   1. the scroll region MUST be `min-h-0 flex-1` — a flex child defaults to
//      min-height:auto and never shrinks below its content, so it never overflows,
//      so it never scrolls; and
//   2. `overflow-y-auto` is UNCONDITIONAL (no snap gate), and NO ancestor between
//      it and <body> may be `touch-action: none` (the sheet is a SIBLING of the
//      Fabric `touch-none` <section>, not a descendant — verified).
// The document lock (position:fixed body) stays; it only stops the PAGE panning
// and does not fight a genuinely-scrollable child.
type Tab = 'text' | 'upload' | 'clipart'

export default function MobileToolSheet({
  open,
  onClose,
  activeTab,
  onSelectTab,
  children,
}: {
  open: boolean
  onClose: () => void
  activeTab: string
  onSelectTab: (tab: Tab) => void
  children: ReactNode
}) {
  // Measure the peek header (Rail) so the collapsed sheet reveals exactly it —
  // robust to Rail height changes (iOS Dynamic Type, etc.) instead of a hardcoded
  // peek height.
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerH, setHeaderH] = useState(64)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => setHeaderH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Design tools"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.14)] transition-transform duration-300 ease-out will-change-transform"
      style={{
        height: '50dvh',
        transform: open ? 'translateY(0)' : `translateY(calc(100% - ${headerH}px))`,
      }}
    >
      {/* Peek header: the tool tabs (always visible) + a collapse chevron (only
          offers itself when open). Tapping a tab opens the sheet to that tool;
          tapping the active tab again collapses it (the parent's sheetSelectTab). */}
      <div ref={headerRef} className="flex items-stretch shrink-0 border-b border-gray-200">
        <div className="flex-1 min-w-0">
          <Rail orientation="horizontal" activeTab={activeTab} onSelectTab={onSelectTab} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse tools"
          className={`flex w-12 shrink-0 items-center justify-center text-gray-500 transition-opacity ${
            open ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <ChevronDown size={22} strokeWidth={2} />
        </button>
      </div>

      {/* The one native scroll region. See the load-bearing notes above. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y"
        style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {children}
      </div>
    </div>
  )
}
