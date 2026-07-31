'use client'
import { type ReactNode } from 'react'
import { Drawer } from 'vaul'
import Rail from './Rail'

// MobileToolSheet — BLOCKER-2 pass 3 (v2, vaul). A bottom sheet (peek / half /
// full) that brings the tools to mobile: a horizontal Rail tab bar + the shared
// SelectionPanel (passed as children). Only rendered when the parent is in mobile
// mode — desktop never mounts it (the desktop left aside owns the single
// SelectionPanel), so desktop stays byte-identical.
//
// v1 hand-built the drag with pointer events; on a real phone it didn't register
// (Denise's backstop) and its scroll region ran off-screen at the half snap. v2
// hands the drag to vaul — purpose-built mobile-sheet drag + snap points — after
// the pre-agreed "vaul-on-evidence" call. modal={false} keeps the canvas behind
// it fully interactive (no overlay, no scroll-lock); dismissible={false} + always-
// open means it never fully closes (peek is the floor). Inner scroll is enabled
// ONLY at the full snap so partial-open drags aren't stolen by the tool list;
// reaching the bottom options = open to full (parent also reserves stage space so
// the shirt sits above the sheet). The parent still owns snap state and drives it
// via snap/setSnap; activeSnapPoint bridges to vaul.
type Snap = 'peek' | 'half' | 'full'
type Tab = 'text' | 'upload' | 'clipart'

// Fractions of screen height: peek shows handle + tab bar; half leaves room for
// the shirt above it; full ~= almost the whole screen. Least → most visible, as
// vaul requires.
const SNAP_POINTS = [0.16, 0.48, 0.92]
const INDEX: Record<Snap, number> = { peek: 0, half: 1, full: 2 }

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
  const activeSnapPoint = SNAP_POINTS[INDEX[snap]]
  const setActiveSnapPoint = (v: number | string | null) => {
    if (v == null) return
    const i = SNAP_POINTS.indexOf(v as number)
    if (i < 0) return // unknown value: don't fight vaul's own snap
    setSnap(i >= 2 ? 'full' : i === 1 ? 'half' : 'peek')
  }

  return (
    <Drawer.Root
      defaultOpen
      modal={false}
      dismissible={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={setActiveSnapPoint}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="lg:hidden fixed inset-x-0 bottom-0 z-30 flex h-[97dvh] flex-col rounded-t-2xl bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.14)] outline-none"
        >
          <Drawer.Handle className="mx-auto my-3 !w-10 !bg-gray-300" />
          <Drawer.Title className="sr-only">Design tools</Drawer.Title>
          <Rail orientation="horizontal" activeTab={activeTab} onSelectTab={onSelectTab} />
          <div
            className={`min-h-0 flex-1 overscroll-contain ${
              snap === 'full' ? 'overflow-y-auto' : 'overflow-hidden'
            }`}
          >
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
