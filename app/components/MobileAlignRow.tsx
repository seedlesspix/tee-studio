'use client'
import {
  AlignLeft, AlignCenter, AlignRight,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react'

// MobileAlignRow — compact align icons + a pinned Delete, for the tool bands' edit
// mode. Uses the UNIVERSAL text-editor align bars for left/center/right and the
// matching vertical bars for top/middle/bottom (shared with the desktop toolbar so
// both layouts look the same). Delete is shrink-0 so it never overlaps the icons.
const ITEMS: { Icon: typeof AlignLeft; title: string; fn: string }[] = [
  { Icon: AlignLeft, title: 'Align left', fn: 'left' },
  { Icon: AlignCenter, title: 'Align center', fn: 'center' },
  { Icon: AlignRight, title: 'Align right', fn: 'right' },
  { Icon: AlignStartHorizontal, title: 'Align top', fn: 'top' },
  { Icon: AlignCenterHorizontal, title: 'Align middle', fn: 'middle' },
  { Icon: AlignEndHorizontal, title: 'Align bottom', fn: 'bottom' },
]

export default function MobileAlignRow({
  alignObject,
  onDelete,
}: {
  alignObject: (fn: string) => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {ITEMS.map(({ Icon, title, fn }) => (
          <button
            key={fn}
            type="button"
            title={title}
            onPointerDown={e => { e.preventDefault(); alignObject(fn) }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-100"
          >
            <Icon size={18} strokeWidth={1.75} />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded border border-red-300 px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50"
      >
        Delete
      </button>
    </div>
  )
}
