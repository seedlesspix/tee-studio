'use client'
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
} from 'lucide-react'

// MobileAlignRow — compact align icons + a pinned Delete, for the Art/Upload bands'
// edit mode. Small icon buttons in a slim strip (ImprintNext-style) rather than the
// big labeled boxes; the icons scroll if they must, and Delete is shrink-0 so it's
// ALWAYS visible and never overlaps the align icons.
const ITEMS: { Icon: typeof AlignHorizontalJustifyStart; title: string; fn: string }[] = [
  { Icon: AlignHorizontalJustifyStart, title: 'Align left', fn: 'left' },
  { Icon: AlignHorizontalJustifyCenter, title: 'Align center', fn: 'center' },
  { Icon: AlignHorizontalJustifyEnd, title: 'Align right', fn: 'right' },
  { Icon: AlignVerticalJustifyStart, title: 'Align top', fn: 'top' },
  { Icon: AlignVerticalJustifyCenter, title: 'Align middle', fn: 'middle' },
  { Icon: AlignVerticalJustifyEnd, title: 'Align bottom', fn: 'bottom' },
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
