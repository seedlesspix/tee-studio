'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getFeaturedImages } from '../lib/shopify'
import { normalizeShopifyProductId } from '../lib/productImages'
import { methodsCompatible } from '../lib/deepLink'
import { useT } from './StringsProvider'

// D2 Design Portability — pick a target garment to re-fit a saved design onto ("Use on another
// product"). Lists the active templated products (the only ones the designer + cut pipeline
// understand); on pick the caller navigates to the designer with ?design_id=…&refit=1.
//
// mode="choose" (Grab 'n Go deep link, 2026-10-16): the picker that opens ON LOAD when a design arrives via
// ?design=T2491 with no garment chosen ("Put it on something"). Differences from the default "switch" mode:
// the garment already on screen stays in the list (tagged, listed first — picking it just closes), only
// garments that can produce the design are offered (allowedMethods ∩ supported_print_methods), and the
// re-fit hint is dropped (the design is placed fresh, nothing is re-fit).

export type TemplateProduct = {
  id: string
  name: string
  shopify_product_id: string
  category?: string | null // BETA #24 — used to list same-category products first
  image?: string | null // representative garment photo (first template color's swatch), when present
  hex?: string | null   // fallback color square when there's no photo
  supported_print_methods?: string[] | null // for the choose-mode compatibility filter
}

export default function ProductPickerModal({
  open, onClose, onPick, excludeProductId, subtitle, preferCategory, mode = 'switch', title, currentProductId, allowedMethods,
}: {
  open: boolean
  onClose: () => void
  onPick: (p: TemplateProduct) => void
  excludeProductId?: string | null // hide the design's origin product (GID)
  subtitle?: string
  preferCategory?: string | null // BETA #24 — the current garment's category; list its category first
  mode?: 'switch' | 'choose'
  title?: string // header override (choose mode: "Put it on something")
  currentProductId?: string | null // choose mode: the garment on screen — kept in the list, tagged, first
  allowedMethods?: string[] | null // choose mode: only garments offering one of these print methods
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
      .select('id, name, shopify_product_id, category, supported_print_methods, product_template_colors(hex, sort_order)')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        type ColorRow = { hex: string | null; sort_order: number | null }
        const rows = (data as Array<{ id: string; name: string; shopify_product_id: string; category: string | null; supported_print_methods: string[] | null; product_template_colors: ColorRow[] | null }> | null) ?? []
        const mapped = rows.map(r => {
          // hex of the first color = the fallback square until the real photo arrives (or if it can't).
          const colors = [...(r.product_template_colors ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          return { id: r.id, name: r.name, shopify_product_id: r.shopify_product_id, category: r.category, supported_print_methods: r.supported_print_methods, image: null as string | null, hex: colors[0]?.hex ?? null }
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
    // CAPTURE phase + stopPropagation: an open picker owns Escape. The designer's own window keydown
    // handler (bubble phase) deselects the active canvas object on Escape, and the React re-render that
    // follows re-registers THIS listener mid-dispatch, so a bubble-phase listener here never saw the same
    // keypress whenever art was selected (the deep-link placement arrives selected) — it took two Escapes
    // to close the picker. Capture runs first and the canvas keeps its selection, as a modal should.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null
  // Exclude the design's ORIGIN garment. Normalize BOTH sides — the saved-design caller passes a bare
  // numeric productId while product_templates.shopify_product_id is a GID, so a raw !== never matched
  // and you could "port" onto the same product. normalizeShopifyProductId canonicalizes both to the GID.
  const choose = mode === 'choose'
  const exGid = !choose && excludeProductId ? normalizeShopifyProductId(excludeProductId) : null
  const curGid = choose && currentProductId ? normalizeShopifyProductId(currentProductId) : null
  const filtered = products.filter(p => {
    const gid = normalizeShopifyProductId(p.shopify_product_id)
    if (exGid && gid === exGid) return false                    // hide the design's origin garment
    if (available && gid && !available.has(gid)) return false   // hide deleted/unpublished (fail open if null / unparseable id)
    if (choose && !methodsCompatible(allowedMethods, p.supported_print_methods)) return false // can't produce this design
    return true
  })
  // BETA #24 — list the current garment's category first (advise), preserving the admin sort_order
  // within each group (stable sort). No preferred category → plain sort_order order.
  const prefer = preferCategory?.trim() || null
  const sorted = prefer
    ? [...filtered].sort((a, b) => (b.category === prefer ? 1 : 0) - (a.category === prefer ? 1 : 0))
    : filtered
  // Choose mode: the garment already on screen leads the list (stable).
  const isCurrent = (p: TemplateProduct) => !!curGid && normalizeShopifyProductId(p.shopify_product_id) === curGid
  const list = curGid ? [...sorted].sort((a, b) => (isCurrent(b) ? 1 : 0) - (isCurrent(a) ? 1 : 0)) : sorted

  return (
    <div className={`fixed inset-0 z-[60] flex items-center p-4 ${choose ? 'justify-center lg:justify-end lg:pr-10' : 'justify-center'}`}>
      {/* Choose mode dims less: the design is already placed on the garment behind this list — let it show. */}
      <div className={`absolute inset-0 ${choose ? 'bg-black/25' : 'bg-black/50'}`} onClick={onClose} aria-hidden="true" />
      {/* Bounded to the viewport with the LIST scrolling inside: the designer locks the page to the viewport on
          desktop, so an unbounded dialog with 30+ garments overflowed it — header and ✕ pushed off-screen, nothing
          scrollable, nothing dismissable. The header + footer stay put; only the list scrolls. */}
      <div role="dialog" aria-label={title ?? t('designer.product_picker.title', 'Use on another product')} className="relative flex w-full max-w-sm max-h-[min(85vh,760px)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <span className="text-xs font-mono uppercase tracking-widest text-gray-900">{title ?? t('designer.product_picker.title', 'Use on another product')}</span>
          <button onClick={onClose} aria-label={t('designer.close', 'Close')} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {subtitle && <p className="mb-2 shrink-0 text-[11px] text-gray-500">{subtitle}</p>}
          {loading ? (
            <p className="py-8 text-center font-mono text-xs text-gray-400">{t('designer.product_picker.loading', 'Loading…')}</p>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-xs text-gray-500">{choose ? t('designer.choose_empty', 'No garments can take this design right now.') : t('designer.product_picker.empty', 'No other products available.')}</p>
          ) : (
            <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1 pb-1">
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
                    {isCurrent(p) && (
                      <span className="ml-auto shrink-0 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-600">
                        {t('designer.choose_current', 'Shown now')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!choose && (
            <p className="mt-3 shrink-0 text-[11px] leading-snug text-gray-400">
              {t('designer.product_picker.refit_hint', 'Your design re-fits onto the new garment automatically — a starting point you can nudge.')}
            </p>
          )}
          {choose && (
            <p className="mt-3 shrink-0 text-[11px] leading-snug text-gray-400">
              {t('designer.choose_hint', 'Your design is already on the garment behind this list. Keep it, or pick another garment.')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
