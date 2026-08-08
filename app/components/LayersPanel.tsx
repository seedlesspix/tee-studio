'use client'
import { Layers, ChevronUp, ChevronDown, Trash2, Type, Image as ImageIcon, Shapes, Hash } from 'lucide-react'
import { useT } from './StringsProvider'

export type LayerKind = 'text' | 'image' | 'art' | 'nn'
export type LayerRow = { id: string; kind: LayerKind; label: string; selected: boolean }

const KIND_ICON = { text: Type, image: ImageIcon, art: Shapes, nn: Hash } as const

// LayersPanel — the designer's "Layers" tool body. A per-side list of everything on the shirt, ordered
// FRONT-MOST FIRST. Tap a row to select that element on the canvas; ▲▼ restack it; 🗑 delete it. It's a
// DUMB VIEW: all canvas logic lives in the parent (DesignerCanvas) and arrives as handlers. Names &
// Numbers shows as ONE locked row that jumps to the Names panel (its stack is app-positioned).
// Red-vocabulary rule: selected row = neutral gray fill (never red); red appears only on the delete action.
export default function LayersPanel({
  rows,
  onSelect,
  onMove,
  onDelete,
}: {
  rows: LayerRow[]
  onSelect: (id: string) => void
  onMove: (id: string, dir: 'up' | 'down') => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2 px-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-800 uppercase tracking-widest font-mono">
        <Layers size={14} strokeWidth={1.75} /> {t('designer.layers_heading', 'Layers')}
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-500">
          {t('designer.layers_empty', 'Nothing on this side yet. Add text or art and it shows up here.')}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => {
            const Icon = KIND_ICON[row.kind]
            const isTop = i === 0
            const isBottom = i === rows.length - 1
            return (
              <div
                key={row.id}
                className={`flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors ${
                  row.selected ? 'border-gray-800 bg-gray-100' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                {/* Tap the label to select this element on the shirt (handy when things overlap). */}
                <button
                  type="button"
                  onClick={() => onSelect(row.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-gray-500" />
                  <span className="truncate text-sm text-gray-900">{row.label}</span>
                  {row.kind === 'nn' && (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-gray-400">{t('designer.layers_locked', 'locked')}</span>
                  )}
                </button>

                {/* N&N is app-positioned — no reorder/delete from here. */}
                {row.kind !== 'nn' && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      title={t('designer.layers_forward', 'Bring forward')}
                      onClick={() => onMove(row.id, 'up')}
                      disabled={isTop}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      <ChevronUp size={16} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      title={t('designer.layers_backward', 'Send backward')}
                      onClick={() => onMove(row.id, 'down')}
                      disabled={isBottom}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      <ChevronDown size={16} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      title={t('designer.layers_delete', 'Delete')}
                      onClick={() => onDelete(row.id)}
                      className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
