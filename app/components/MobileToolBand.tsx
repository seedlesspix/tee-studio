'use client'
import { type ReactNode } from 'react'
import Rail from './Rail'

// MobileToolBand — BLOCKER-2 mobile rework, Stage 1 (ImprintNext pattern). An
// IN-FLOW compact tool band at the bottom of the mobile column: a FIXED-height
// controls area (children = the active tool's controls) with the horizontal Rail
// icon strip beneath it.
//
// This replaces the v3 overlay sheet. The whole point: it is a normal flex-col
// block, NOT a position:fixed overlay — so it NEVER covers the shirt. The shirt
// (flex-1 above it in the column) is sized ONCE and never resizes when you switch
// tools. That deletes the entire shrink / rise / covered-shirt problem.
//
// Height is FIXED on purpose (a variable-height band would reintroduce the
// covered-shirt problem by pushing the shirt around). Long lists inside the band
// scroll HORIZONTALLY — added per-tool in the following stages. Only rendered on
// mobile (isMobile); desktop uses the left aside, so desktop is untouched.
//
// The band is CLOSED on load (just the icon strip) so the shirt gets full space
// and the on-shirt "Let's build it" card is the sole invitation; it OPENS when a
// tool/CTA is tapped or an object is selected. Stage 1 is STRUCTURE only: while
// open it shows the existing controls in a vertical scroll (interim). Stages 2+
// replace each tool with a compact horizontal layout (font chips + horizontal
// preview row, colour row, etc.).
type Tab = 'text' | 'upload' | 'clipart'

export default function MobileToolBand({
  open,
  keyboardMode = false,
  keyboardInset = 0,
  activeTab,
  onSelectTab,
  children,
}: {
  open: boolean
  // Keyboard mode: the whole band becomes a FIXED white bar docked directly above
  // the iOS keyboard (bottom = the keyboard height), showing ONLY the textarea (its
  // children hide their own chrome; the Rail + safe-area hide here). It's an explicit
  // white background so nothing shows through, and the column is left untouched so it
  // can't collapse to a black void. Same textarea DOM node (class/position only) → no
  // remount, focus preserved. When keyboard is DOWN it's a normal in-flow band.
  keyboardMode?: boolean
  keyboardInset?: number
  activeTab: string
  onSelectTab: (tab: Tab) => void
  children: ReactNode
}) {
  return (
    <div
      className={`lg:hidden flex flex-col shrink-0 border-t border-gray-200 bg-white ${
        keyboardMode ? 'fixed inset-x-0 z-40 shadow-[0_-4px_20px_rgba(0,0,0,0.12)]' : ''
      }`}
      style={keyboardMode ? { bottom: keyboardInset } : undefined}
    >
      {/* Fixed-height controls band — only when OPEN. Compact horizontal tool layouts
          live in the children; in keyboard mode the children show only the textarea. */}
      {open && (
        <div
          className="h-40 overflow-y-auto overscroll-contain touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>
      )}
      {/* Bottom icon strip — tool categories (hidden in keyboard mode) */}
      <div className={keyboardMode ? 'hidden' : ''}>
        <Rail orientation="horizontal" activeTab={activeTab} onSelectTab={onSelectTab} />
      </div>
      {/* Home-indicator safe area so the strip clears the gesture bar */}
      <div className={keyboardMode ? 'hidden' : ''} style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  )
}
