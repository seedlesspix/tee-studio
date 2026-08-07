'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// D2 Design Portability — pick a target garment to re-fit a saved design onto ("Use on another
// product"). Lists the active templated products (the only ones the designer + cut pipeline
// understand); on pick the caller navigates to the designer with ?design_id=…&refit=1.

export type TemplateProduct = {
  id: string
  name: string
  shopify_product_id: string
  image?: string | null // representative garment photo (first template color's swatch), when present
  hex?: string | null   // fallback color square when there's no photo
}

export default function ProductPickerModal({
  open, onClose, onPick, excludeProductId, subtitle,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: TemplateProduct) => void
  excludeProductId?: string | null // hide the design's origin product (GID)
  subtitle?: string
}) {
  const [products, setProducts] = useState<TemplateProduct[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    supabase
      .from('product_templates')
      .select('id, name, shopify_product_id, product_template_colors(hex, swatch_image_url, sort_order)')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        type ColorRow = { hex: string | null; swatch_image_url: string | null; sort_order: number | null }
        const rows = (data as Array<{ id: string; name: string; shopify_product_id: string; product_template_colors: ColorRow[] | null }> | null) ?? []
        setProducts(rows.map(r => {
          // Representative photo = the first template color (by sort order) that has an uploaded swatch;
          // fall back to the first color's hex as a solid square, so a row is never a blank rectangle.
          const colors = [...(r.product_template_colors ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          return {
            id: r.id,
            name: r.name,
            shopify_product_id: r.shopify_product_id,
            image: colors.find(c => c.swatch_image_url)?.swatch_image_url ?? null,
            hex: colors[0]?.hex ?? null,
          }
        }))
        setLoading(false)
      })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const list = products.filter(p => !excludeProductId || p.shopify_product_id !== excludeProductId)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Use on another product" className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between px-4 h-12 border-b border-gray-200">
          <span className="text-xs font-mono uppercase tracking-widest text-gray-900">Use on another product</span>
          <button onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </header>
        <div className="p-3">
          {subtitle && <p className="mb-2 text-[11px] text-gray-500">{subtitle}</p>}
          {loading ? (
            <p className="py-8 text-center font-mono text-xs text-gray-400">Loading…</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">No other products available.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {list.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm font-medium text-gray-900 transition-colors hover:border-[#dd3333] hover:bg-gray-50"
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="h-11 w-11 shrink-0 rounded-md border border-gray-200 object-cover" />
                    ) : (
                      <span className="h-11 w-11 shrink-0 rounded-md border border-gray-200"
                        style={{ background: p.hex || '#e5e7eb' }} aria-hidden="true" />
                    )}
                    <span className="min-w-0 truncate">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-snug text-gray-400">
            Your design re-fits onto the new garment automatically — a starting point you can nudge.
          </p>
        </div>
      </div>
    </div>
  )
}
