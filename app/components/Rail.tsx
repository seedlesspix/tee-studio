'use client'

import { Shirt, Type, Upload, Shapes, Hash, Layers } from 'lucide-react'
import { useT } from './StringsProvider'

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
// WIRED vs PLACEHOLDER: Text/Upload/Art/Names map to the existing tabs (Art is a
// label-only rename of the `clipart` tab — internal key unchanged, same trick as
// screen_print→"Print"). Products (= Design Portability, D2.5) is an ACTION item,
// not a tab: it opens the switch-garment picker via onProducts instead of driving
// activeTab. It's enabled only when onProducts is supplied (else it falls back to
// the dimmed "Soon" placeholder). Layers IS a rail item now (Denise 2026-08-07,
// reversing the earlier "deliberately not a rail item" call) — it's the manage
// view (reorder/select/delete placed elements), the same place customers reach
// every other tool, and it must reach the phone bottom bar (where overlap is
// hardest to tap), which the shared rail gives for free.
//
// Phase 2 next visual sub-pass (logged, NOT here): the PANEL red-sweep — flip the
// SelectionPanel's remaining red-for-selection states to quiet (selected-font
// border, selected color-swatch ring, active align/direction/effects buttons).
type Tab = 'text' | 'upload' | 'clipart' | 'names' | 'layers'

type RailItem = {
  key: string
  label: string
  Icon: typeof Shirt
  wired: boolean
  action?: boolean // fires a callback (Products = switch garment) instead of driving activeTab
}

const ITEMS: RailItem[] = [
  { key: 'products', label: 'Products',        Icon: Shirt,  wired: true, action: true },
  { key: 'text',     label: 'Text',            Icon: Type,   wired: true  },
  { key: 'upload',   label: 'Upload',          Icon: Upload, wired: true  },
  { key: 'clipart',  label: 'Art',             Icon: Shapes, wired: true  },
  { key: 'names',    label: 'Names & Numbers', Icon: Hash,   wired: true  },
  { key: 'layers',   label: 'Layers',          Icon: Layers, wired: true  },
]

export default function Rail({
  activeTab,
  onSelectTab,
  onProducts,
  hiddenKeys,
  orientation = 'vertical',
}: {
  activeTab: string
  onSelectTab: (tab: Tab) => void
  // D2.5 switch-garment: opens the product picker. When omitted, Products falls back to a
  // dimmed "Soon" placeholder (keeps the rail honest if the feature isn't wired on a surface).
  onProducts?: () => void
  // Embroidery mode: rail item keys to OMIT entirely (e.g. ['upload','names'] — raster uploads and the
  // print cut-file N&N don't apply to embroidery). Hidden, not greyed (Denise's call).
  hiddenKeys?: string[]
  // 'vertical' = the desktop side-strip (default, unchanged). 'horizontal' = the
  // mobile bottom-sheet tab bar (same items; active marker moves to the bottom).
  orientation?: 'vertical' | 'horizontal'
}) {
  const t = useT()
  const horizontal = orientation === 'horizontal'
  // Bottom bar (mobile): the active marker rides the TOP edge of the item (nearest
  // the content) so it's visible; the side rail (desktop) keeps its left marker.
  const marker = horizontal ? 'border-t-2' : 'border-l-2'
  const items = hiddenKeys?.length ? ITEMS.filter(i => !hiddenKeys.includes(i.key)) : ITEMS
  return (
    <nav className={horizontal
      ? 'flex flex-row items-stretch bg-white border-t border-gray-200'
      : 'w-[76px] shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col py-2'}>
      {items.map(({ key, label, Icon, wired, action }) => {
        // Action items (Products) are enabled only when their handler is supplied; they never
        // read as the persistent "active" tab. Other items are the usual activeTab drivers.
        const enabled = action ? !!onProducts : wired
        const active = !action && wired && activeTab === key
        const handleClick = action ? onProducts : () => onSelectTab(key as Tab)
        const tLabel = t(`designer.rail_${key}`, label)
        return (
          <button
            key={key}
            type="button"
            disabled={!enabled}
            onClick={enabled ? handleClick : undefined}
            aria-current={active ? 'page' : undefined}
            title={enabled ? tLabel : `${tLabel} — ${t('designer.rail_coming_soon', 'coming soon')}`}
            className={`relative flex flex-col items-center gap-1 px-1 py-2.5 text-center transition-colors ${horizontal ? 'flex-1' : ''} ${
              !enabled
                ? 'text-gray-300 cursor-default'
                : active
                  ? `${horizontal ? 'bg-gray-100' : 'bg-white'} text-gray-900 font-semibold ${marker} border-gray-900`
                  : `${horizontal ? 'text-gray-400' : 'text-gray-500'} hover:text-gray-900 hover:bg-gray-100 ${marker} border-transparent`
            }`}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span className="text-[10px] leading-tight">{tLabel}</span>
            {!enabled && (
              <span className="text-[8px] uppercase tracking-wide text-gray-400 font-mono">{t('designer.rail_soon', 'Soon')}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
