'use client'
import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react'

// MobileAlignRow — compact OBJECT-alignment icons + a pinned Delete, for the tool bands' edit mode.
// Illustrator "Align" panel glyphs (boxes against a guide) — left/center/right position the object
// horizontally, top/middle/bottom vertically; shared with the desktop toolbar so both layouts match.
// Distinct from the Text sheet's paragraph-align (lines). Delete is shrink-0 so it never overlaps.
const ITEMS: { Icon: typeof AlignStartVertical; title: string; fn: string }[] = [
  { Icon: AlignStartVertical, title: 'Align left', fn: 'left' },
  { Icon: AlignCenterVertical, title: 'Align center', fn: 'center' },
  { Icon: AlignEndVertical, title: 'Align right', fn: 'right' },
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
