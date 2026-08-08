'use client'
import { useEffect } from 'react'
import { useT } from './StringsProvider'

// Presentational "My Designs" slide-over. State (fetch/delete) lives in
// DesignerCanvas; this component renders tiles and reports open/delete.
// Each tile points at a saved design_orders row — opening one restores it into
// the designer via ?restore=<designId>.

export type SavedDesign = {
  savedId: string
  designId: string
  name: string | null
  updatedAt: string
  thumbnailUrl: string | null
  productTitle: string | null
  color: string | null
  productId: string | null
  variantId: string | null
  unitPrice: number | null
}

type Props = {
  open: boolean
  designs: SavedDesign[]
  loading: boolean
  onClose: () => void
  onOpenDesign: (d: SavedDesign) => void
  onUseOnProduct: (d: SavedDesign) => void
  onDelete: (savedId: string) => void
}

const when = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MyDesignsDrawer({
  open, designs, loading, onClose, onOpenDesign, onUseOnProduct, onDelete,
}: Props) {
  const t = useT() // admin-editable wording (Language editor)
  const label = (d: SavedDesign) => d.name || d.productTitle || t('designer.designs.untitled', 'Untitled design')
  // Escape closes — a slide-over that traps you is worse than no slide-over.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="My Designs"
        className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-5 h-14 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-widest text-[#dd3333]">{t('designer.designs.heading', 'My Designs')}</span>
            {designs.length > 0 && (
              <span className="text-[10px] font-mono text-gray-400">{designs.length}</span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('designer.designs.close', 'Close')}
            className="w-7 h-7 rounded-full text-gray-500 hover:text-white hover:bg-[#dd3333] flex items-center justify-center text-sm transition-colors"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-xs text-gray-400 font-mono text-center py-10">{t('designer.designs.loading', 'Loading…')}</p>
          ) : designs.length === 0 ? (
            <div className="border border-dashed border-gray-200 rounded-xl px-6 py-10 text-center">
              <p className="text-3xl mb-2">👕</p>
              <p className="text-sm text-gray-600">{t('designer.designs.empty_title', 'No saved designs yet')}</p>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                {t('designer.designs.empty_hint_pre', 'Click')} <span className="font-semibold text-gray-600">{t('designer.designs.empty_save_word', 'Save design')}</span> {t('designer.designs.empty_hint_post', 'while you work and it’ll show up here to pick back up any time.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {designs.map(d => (
                <div
                  key={d.savedId}
                  className="group relative rounded-lg border border-gray-200 bg-white overflow-hidden hover:border-[#dd3333] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenDesign(d)}
                    title={`${t('designer.designs.open', 'Open')} "${label(d)}"`}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-square bg-gray-50 flex items-center justify-center p-2">
                      {d.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.thumbnailUrl} alt={label(d)} className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-3xl opacity-20">👕</span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-[#dd3333]/85 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[11px] font-bold uppercase tracking-wide">
                        {t('designer.designs.open', 'Open')}
                      </span>
                    </div>
                    <div className="px-2.5 py-2 border-t border-gray-100">
                      <p className="text-xs font-semibold text-gray-900 truncate">{label(d)}</p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {[d.color, when(d.updatedAt)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUseOnProduct(d)}
                    title={t('designer.designs.use_tooltip', 'Use this design on another product')}
                    className="block w-full border-t border-gray-100 px-2.5 py-1.5 text-left text-[10px] font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-[#dd3333]"
                  >
                    {t('designer.designs.use_button', '↪ Use on another product')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(d.savedId)}
                    title={t('designer.designs.remove_tooltip', 'Remove from My Designs')}
                    className="absolute top-1.5 right-1.5 w-6 h-6 lg:w-5 lg:h-5 rounded-full bg-white/90 border border-gray-200 text-gray-500 hover:text-white hover:bg-[#dd3333] hover:border-[#dd3333] flex items-center justify-center text-[11px] leading-none shadow-sm opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
