'use client'

import { Shirt, Type, Upload, Shapes, Hash } from 'lucide-react'

// Rail — the designer's tool selector, now the sealed vertical ICON RAIL.
//
// A narrow fixed strip on the far left of the tool aside (SelectionPanel sits to
// its right). Five items, icon + label: Products · Text · Upload · Art · Names &
// Numbers. Drives the parent's activeTab via onSelectTab for the WIRED items; the
// panel below still reads activeTab unchanged.
//
// RED-VOCABULARY RULE (locked): red = ACTION only. The active item is a QUIET
// non-red treatment — raised white surface + a neutral left marker bar + bolder
// text — NOT the old red fill. Red never appears in the rail.
//
// WIRED vs PLACEHOLDER: Text/Upload/Art map to the existing tabs (Art is a
// label-only rename of the `clipart` tab — internal key unchanged, same trick as
// screen_print→"Print"). Products (= Design Portability) and Names & Numbers are
// their own future builds, so they're shown-but-not-wired: dimmed, non-clickable,
// tagged "Soon" — visible so the rail reads complete, honest that they don't work
// yet. Layers is deliberately NOT a rail item (separate desktop-only surface).
//
// Phase 2 next visual sub-pass (logged, NOT here): the PANEL red-sweep — flip the
// SelectionPanel's remaining red-for-selection states to quiet (selected-font
// border, selected color-swatch ring, active align/direction/effects buttons).
type Tab = 'text' | 'upload' | 'clipart'

type RailItem = {
  key: string
  label: string
  Icon: typeof Shirt
  wired: boolean
}

const ITEMS: RailItem[] = [
  { key: 'products', label: 'Products',        Icon: Shirt,  wired: false },
  { key: 'text',     label: 'Text',            Icon: Type,   wired: true  },
  { key: 'upload',   label: 'Upload',          Icon: Upload, wired: true  },
  { key: 'clipart',  label: 'Art',             Icon: Shapes, wired: true  },
  { key: 'names',    label: 'Names & Numbers', Icon: Hash,   wired: false },
]

export default function Rail({
  activeTab,
  onSelectTab,
}: {
  activeTab: string
  onSelectTab: (tab: Tab) => void
}) {
  return (
    <nav className="w-[76px] shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col py-2">
      {ITEMS.map(({ key, label, Icon, wired }) => {
        const active = wired && activeTab === key
        return (
          <button
            key={key}
            type="button"
            disabled={!wired}
            onClick={wired ? () => onSelectTab(key as Tab) : undefined}
            aria-current={active ? 'page' : undefined}
            title={wired ? label : `${label} — coming soon`}
            className={`relative flex flex-col items-center gap-1 px-1 py-2.5 text-center transition-colors ${
              !wired
                ? 'text-gray-300 cursor-default'
                : active
                  ? 'bg-white text-gray-900 font-semibold border-l-2 border-gray-900'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 border-l-2 border-transparent'
            }`}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span className="text-[10px] leading-tight">{label}</span>
            {!wired && (
              <span className="text-[8px] uppercase tracking-wide text-gray-400 font-mono">Soon</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
