'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getFeaturedImages } from '../lib/shopify'
import { normalizeShopifyProductId } from '../lib/productImages'
import { useT } from './StringsProvider'

// D2 Design Portability — pick a target garment to re-fit a saved design onto ("Use on another
// product"). Lists the active templated products (the only ones the designer + cut pipeline
// understand); on pick the caller navigates to the designer with ?design_id=…&refit=1.

export type TemplateProduct = {
  id: string
  name: string
  shopify_product_id: string
  category?: string | null // BETA #24 — used to list same-category products first
  image?: string | null // representative garment photo (first template color's swatch), when present
  hex?: string | null   // fallback color square when there's no photo
}

export default function ProductPickerModal({
  open, onClose, onPick, excludeProductId, subtitle, preferCategory,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: TemplateProduct) => void
  excludeProductId?: string | null // hide the design's origin product (GID)
  subtitle?: string
  preferCategory?: string | null // BETA #24 — the current garment's category; list its category first
}) {
  const [products, setProducts] = useState<TemplateProduct[]>([])
  const [loading, setLoading] = useState(true)
  // Normalized GIDs that resolve to a live Shopify product (= same availability check the admin badge +
  // designer use). null = not yet determined / call failed → don't filter (fail open). A deleted or
  // unpublished product is excluded so a customer can't pick it and dead-end on the unavailable page.
  const [available, setAvailable] = useState<Set<string> | null>(null)
  const t = useT()

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setAvailable(null)
    supabase
      .from('product_templates')
      .select('id, name, shopify_product_id, category, product_template_colors(hex, sort_order)')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        type ColorRow = { hex: string | null; sort_order: number | null }
        const rows = (data as Array<{ id: string; name: string; shopify_product_id: string; category: string | null; product_template_colors: ColorRow[] | null }> | null) ?? []
        const mapped = rows.map(r => {
          // hex of the first color = the fallback square until the real photo arrives (or if it can't).
          const colors = [...(r.product_template_colors ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          return { id: r.id, name: r.name, shopify_product_id: r.shopify_product_id, category: r.category, image: null as string | null, hex: colors[0]?.hex ?? null }
        })
        setProducts(mapped)
        setLoading(false)
        // Real garment photos + availability: one batched Storefront call. Merge images in when they
        // arrive (hex square meanwhile), and record which products actually resolve so unavailable ones
        // (deleted/unpublished) drop out of the picker instead of dead-ending the customer.
        getFeaturedImages(mapped.map(m => m.shopify_product_id)).then(({ images, available }) => {
          if (!alive) return
          setProducts(prev => prev.map(p => ({ ...p, image: images[p.shopify_product_id] ?? p.image })))
          setAvailable(available ? new Set([...available].map(normalizeShopifyProductId).filter((g): g is string => g != null)) : null)
        })
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
  // Exclude the design's ORIGIN garment. Normalize BOTH sides — the saved-design caller passes a bare
  // numeric productId while product_templates.shopify_product_id is a GID, so a raw !== never matched
  // and you could "port" onto the same product. normalizeShopifyProductId canonicalizes both to the GID.
  const exGid = excludeProductId ? normalizeShopifyProductId(excludeProductId) : null
  const filtered = products.filter(p => {
    const gid = normalizeShopifyProductId(p.shopify_product_id)
    if (exGid && gid === exGid) return false                    // hide the design's origin garment
    if (available && gid && !available.has(gid)) return false   // hide deleted/unpublished (fail open if null / unparseable id)
    return true
  })
  // BETA #24 — list the current garment's category first (advise), preserving the admin sort_order
  // within each group (stable sort). No preferred category → plain sort_order order.
  const prefer = preferCategory?.trim() || null
  const list = prefer
    ? [...filtered].sort((a, b) => (b.category === prefer ? 1 : 0) - (a.category === prefer ? 1 : 0))
    : filtered

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="Use on another product" className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between px-4 h-12 border-b border-gray-200">
          <span className="text-xs font-mono uppercase tracking-widest text-gray-900">{t('designer.product_picker.title', 'Use on another product')}</span>
          <button onClick={onClose} aria-label={t('designer.close', 'Close')} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </header>
        <div className="p-3">
          {subtitle && <p className="mb-2 text-[11px] text-gray-500">{subtitle}</p>}
          {loading ? (
            <p className="py-8 text-center font-mono text-xs text-gray-400">{t('designer.product_picker.loading', 'Loading…')}</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">{t('designer.product_picker.empty', 'No other products available.')}</p>
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
                      // Garment mockups are portrait — object-contain on a white tile shows the WHOLE
                      // product (object-cover cropped them into swatch-like squares).
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="h-14 w-14 shrink-0 rounded-md border border-gray-200 bg-white object-contain p-0.5" />
                    ) : (
                      <span className="h-14 w-14 shrink-0 rounded-md border border-gray-200"
                        style={{ background: p.hex || '#e5e7eb' }} aria-hidden="true" />
                    )}
                    <span className="min-w-0 truncate">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] leading-snug text-gray-400">
            {t('designer.product_picker.refit_hint', 'Your design re-fits onto the new garment automatically — a starting point you can nudge.')}
          </p>
        </div>
      </div>
    </div>
  )
}
