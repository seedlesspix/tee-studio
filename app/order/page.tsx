'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tables } from '@/types/database'
import { type RosterEntry, rosterShirtCount } from '@/app/lib/namesNumbers'
import Stepper from '@/app/components/Stepper'
import BrandMark from '@/app/components/BrandMark'
import { useT } from '@/app/components/StringsProvider'
import Spinner from '@/app/components/Spinner'
import { format } from '@/app/lib/uiStrings'
import { supabase } from '@/app/lib/supabase'
import { VOLUME_DISCOUNT, currentTier, nextTier, resolveTiers, type VolumeTier } from '@/app/lib/volumeTiers'
import { orderZones, zoneLabel } from '@/app/lib/zones'

type DesignOrder = Omit<Tables<'design_orders'>, 'quantities'> & {
  quantities: Record<string, number> | null
}

// Robust FIRST-PARTY cart hand-off (2026-08-10). Submit a top-level form to the STORE's /cart/add so
// Shopify sets the `cart` cookie itself, first-party on tshirtdeli.com — exactly like any normal
// "Add to cart" button. This replaced the old flow where our API added the item server-side and RELAYED
// Shopify's cart cookie re-scoped to .tshirtdeli.com: browsers stopped keeping that cross-subdomain
// relayed cookie after Shopify's signed-cart-token change, so the item went into a cart the browser
// didn't hold and checkout showed "cart is empty". A first-party form add has no such dependency.
function submitToStoreCart(
  action: string,
  items: Array<{ id: number; quantity: number; properties?: Record<string, string> }>,
) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = action
  form.style.display = 'none'
  const field = (name: string, value: string) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value // DOM value assignment — no HTML injection from roster names
    form.appendChild(input)
  }
  items.forEach((it, n) => {
    field(`items[${n}][id]`, String(it.id))
    field(`items[${n}][quantity]`, String(it.quantity))
    for (const [k, v] of Object.entries(it.properties ?? {})) field(`items[${n}][properties][${k}]`, v)
  })
  field('return_to', '/cart') // Shopify redirects here after adding
  document.body.appendChild(form)
  form.submit()
}

function OrderPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const designId = searchParams.get('design_id')
  // Edit-from-cart (item 28): the design_order id whose existing cart line(s) this add should REPLACE
  // (the edit minted a new design row, so this is the ORIGINAL). Threaded through from the designer.
  const replaceCart = searchParams.get('replace_cart') || ''
  // …and the exact old cart LINE KEY, so we can remove just that line first-party (seamless replace).
  const replaceLine = searchParams.get('replace_line') || ''
  const [design, setDesign] = useState<DesignOrder | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // Sizes in Shopify variant order (from the design's available_sizes) — the
  // merchant's intended display order, never alphabetized or a hardcoded list.
  const [orderedSizes, setOrderedSizes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')
  const [desiredBy, setDesiredBy] = useState('') // BETA #30 — optional ISO date (YYYY-MM-DD)
  const [acknowledged, setAcknowledged] = useState(false) // BETA #32 — must be actively checked to add to cart
  // This garment's per-product volume ladder (product_templates.volume_tiers, public read) — drives
  // the incentive display only; the real % comes off at checkout via the Shopify discount Function.
  const [volumeTiers, setVolumeTiers] = useState<VolumeTier[]>([])

  useEffect(() => {
    if (!designId) return
    // BLOCKER-1 lockdown: reads flow through the server route (service role)
    // — the public RLS read policy is gone. Same URL-as-key semantics.
    fetch(`/api/design-orders/${designId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        const data = payload?.order as DesignOrder | undefined
        if (!data) { setError(t('order.error_not_found', 'Design not found')); setLoading(false); return }
        const order = data
        setDesign(order)
        setNotes(order.notes ?? '')
        setDesiredBy(order.desired_by ?? '')
        const initQty: Record<string, number> = {}
        const savedQuantities = order.quantities ?? {}
        // Sizes come from the design's saved available_sizes, already in Shopify
        // variant order (real per-product sizes). Fall back to whatever sizes the
        // saved quantities use — never a hardcoded adult list.
        const sizesToUse: string[] =
          (order.available_sizes?.length ?? 0) > 0
            ? order.available_sizes!
            : Object.keys(savedQuantities)
        sizesToUse.forEach((s) => { initQty[s] = savedQuantities[s] ?? 0 })
        setOrderedSizes(sizesToUse)
        setQuantities(initQty)
        setLoading(false)
        // This garment's volume ladder (public-read template row), resolved by THIS design's method so
        // the shown ladder matches what checkout charges. Non-blocking; no tiers → no display.
        if (order.template_id) {
          supabase.from('product_templates').select('volume_tiers, volume_tiers_embroidery').eq('id', order.template_id).maybeSingle()
            .then(({ data }) => setVolumeTiers(resolveTiers(order.print_method, data?.volume_tiers, data?.volume_tiers_embroidery)))
        }
      })
  }, [designId])

  // Render in Shopify variant order (orderedSizes) — no alphabetical/hardcoded
  // sort, which would scramble both "3-6mo, 6-12mo" and "S, M, L".
  const sortedSizes = orderedSizes
  // Names & Numbers: the saved roster is this order's source of truth for who gets which shirt. For
  // N&N we show the roster manifest (read-only) instead of the size steppers; personalization is
  // Option 1 (already inside the per-side print charge), so no separate line adds money.
  const rosterEntries: RosterEntry[] = Array.isArray(design?.roster) ? (design!.roster as unknown as RosterEntry[]) : []
  const nnActive = rosterEntries.length > 0
  // N&N shirt count comes from the ROSTER — NOT the size-filtered `quantities`. A roster size that
  // isn't one of this product's sizes (pasted, or ported from a different garment) would otherwise
  // vanish from the total and silently $0-out the order (disabling checkout with no explanation). We
  // surface any such mismatch instead so the customer can fix it in the designer, not hit a dead end.
  // Compare against the product's TRUE available sizes (what the cart-add route validates), NOT the
  // orderedSizes state — which falls back to the roster's OWN sizes when available_sizes is empty and
  // would then never flag a mismatch, letting the customer click into the route's raw 422. An order
  // with no available sizes therefore blocks here with the actionable message, keeping page ⇄ route in step.
  const availSizes = (design?.available_sizes ?? []) as string[]
  const badRosterSizes = nnActive
    ? [...new Set(rosterEntries.filter(e => !e.size || !availSizes.includes(e.size)).map(e => e.size || '(blank)'))]
    : []
  const totalQty = nnActive ? rosterShirtCount(rosterEntries) : Object.values(quantities).reduce((a, b) => a + b, 0)
  const pricePerItem = design ? ((design.unit_price ?? 0) + (design.print_charge ?? 0)) : 0
  const total = (totalQty * pricePerItem).toFixed(2)
  // When a volume tier is met the "Order total" is the PRE-discount figure (de-emphasized below).
  const activeTier = VOLUME_DISCOUNT.enabled && volumeTiers.length > 0 ? currentTier(totalQty, volumeTiers) : null
  // Manifest shows a Title column only when the roster actually uses titles (optional field).
  const nnHasTitle = rosterEntries.some(e => (e.title ?? '').trim() !== '')
  const nnGrid = nnHasTitle ? 'minmax(0,1fr) 44px minmax(0,1fr) 52px 32px' : 'minmax(0,1fr) 44px 52px 32px'

  // Per-side print-charge split. Read the exact captured columns (Day-4). Fall
  // back to deriving from side presence for legacy rows saved before the split
  // was captured (those have null print_charge_front/back).
  const printChargeTotal = design?.print_charge ?? 0
  const frontDesigned = !!design?.canvas_png_front
  const backDesigned = !!design?.canvas_png_back
  const bothSides = frontDesigned && backDesigned
  // Does this product HAVE a back print side? The template's back print area is frozen onto the
  // order (print_area_back) regardless of whether the customer designed on it — so we can show the
  // back explicitly as blank when the product supports one. (#4)
  const productHasBack = !!(design?.print_area_back || design?.print_area_back_id)
  const frontCharge = design?.print_charge_front
    ?? (frontDesigned ? (bothSides ? printChargeTotal / 2 : printChargeTotal) : 0)
  const backCharge = design?.print_charge_back
    ?? (backDesigned ? (bothSides ? printChargeTotal / 2 : printChargeTotal) : 0)
  // Print Zones: extra zones (sleeves/hat) captured on the order (front/back stay in the columns above).
  // Each carries its own preview PNG + print_charge in the zones jsonb.
  const zoneMap: Record<string, { canvas_png?: string | null; print_charge?: number | null }> =
    (design?.zones && typeof design.zones === 'object' && !Array.isArray(design.zones))
      ? (design.zones as Record<string, { canvas_png?: string | null; print_charge?: number | null }>)
      : {}
  const extraZones = orderZones(Object.keys(zoneMap)).filter(z => z !== 'front' && z !== 'back')
  const hasAnyExtra = extraZones.some(z => !!zoneMap[z]?.canvas_png)

  // Phase 4 Day 6 (revised): one call renders the design as an ephemeral
  // Shopify product (per-size variants at the folded per-shirt price) and
  // joins it to the CUSTOMER'S REAL storefront cart — where it mixes with
  // other designs and off-the-shelf products for one checkout, done natively
  // from /cart when they finish shopping. One honest line per size; the old
  // Print Charge line-item machinery stays gone.
  // `force` (only ever true via the "add another copy" confirm below) re-adds a design that's already in
  // the cart. Typed boolean + `=== true` guards so a stray click-event arg can never force silently.
  const handleAddToCart = async (force = false) => {
    if (!design || totalQty === 0) { setError(t('order.error_select_size', 'Please select at least one size and quantity.')); return }
    if (nnActive && badRosterSizes.length) { setError(format(t('order.nn_bad_sizes', "Some roster rows use a size this product doesn't offer ({sizes}). Go back to Edit Design to fix those sizes before checkout."), { sizes: badRosterSizes.join(', ') })); return }
    setAdding(true)
    setError('')

    const res = await fetch(`/api/design-orders/${design.id}/add-to-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantities, notes: notes.trim() || null, desired_by: desiredBy || null, acknowledged: true, ...(replaceCart ? { replaceDesignOrderId: replaceCart } : {}), ...(force === true ? { force: true } : {}) }),
    }).catch(() => null)

    if (!res || !res.ok) {
      const detail = res ? await res.json().catch(() => null) : null
      setError(detail?.error ?? t('order.error_add_failed', 'Could not add to cart — please try again.'))
      setAdding(false)
      return
    }

    const data = (await res.json()) as {
      cartUrl: string
      warning?: string
      alreadyInCart?: boolean
      addUrl?: string
      items?: Array<{ id: number; quantity: number; properties?: Record<string, string> }>
    }
    // Already handed off once (server saw status='cart_created'). Default: send them to the cart to adjust
    // quantity natively — never silently add a duplicate (that would double-charge). Escape hatch: if they
    // removed the line and genuinely want it back, confirm to add another copy (re-runs forcing the add).
    if (data.alreadyInCart && force !== true) {
      setAdding(false)
      const viewCart = window.confirm(t('order.already_in_cart_confirm', 'This design is already in your cart. Select OK to view your cart, or Cancel to add another copy.'))
      if (viewCart) { window.location.assign(data.cartUrl); return }
      return handleAddToCart(true)
    }
    // Edit-from-cart (item 28), SEAMLESS replace. We have the old line's KEY, so remove exactly that line
    // ourselves — first-party — BEFORE adding the edited one, so the customer ends with a single line (no
    // duplicate). The store cart cookie is host-only on tshirtdeli.com and never reaches this subdomain,
    // so the removal is a same-site "simple" cross-origin POST to /cart/update (form-encoded, no preflight,
    // credentials included → the Lax cart cookie rides along). We AWAIT it so it lands before we navigate
    // away, and it's best-effort: the edited design is added regardless. The variant was already
    // probe-confirmed server-side, so the add below won't fail — safe to remove first.
    if (replaceLine && data.addUrl) {
      const storeOrigin = new URL(data.cartUrl).origin
      let removeFailed = false
      const remove = fetch(`${storeOrigin}/cart/update`, {
        method: 'POST',
        mode: 'no-cors',
        credentials: 'include',
        keepalive: true, // survive the top-level navigation below, so a slow removal still lands (never dropped)
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `updates[${encodeURIComponent(replaceLine)}]=0`,
      }).catch(() => { removeFailed = true }) // network-level failure — fall back to the warning below
      // Cap the wait so a slow store never hangs checkout — proceed to the add either way (keepalive
      // finishes the removal in the background if it's slow).
      await Promise.race([remove, new Promise(res => setTimeout(res, 4000))])
      // Only the DETECTABLE failure (network reject) restores the "remove the old line yourself" note —
      // an opaque no-cors response can't reveal an HTTP error, but keepalive makes the drop-on-navigation
      // case (the common concern) moot.
      if (removeFailed && data.warning) alert(data.warning)
    } else if (data.warning) {
      // No line key (older link / un-updated theme) — fall back to the "remove the old line yourself" note.
      alert(data.warning)
    }
    // Robust first-party hand-off: let the STORE add the item + set the cart cookie itself, via a
    // top-level form POST to /cart/add. This is the fix for the cross-subdomain cookie drop that was
    // emptying carts. (alreadyInCart and other edge paths return no items and just navigate.)
    if (data.addUrl && data.items && data.items.length) {
      submitToStoreCart(data.addUrl, data.items) // navigates the browser to the store, then /cart
      return
    }
    window.location.assign(data.cartUrl)
  }

  if (loading) return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 text-gray-500">
      <Spinner size={28} />
      <p className="font-mono text-sm">{t('order.loading', 'Loading your design...')}</p>
    </div>
  )

  if (error && !design) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-red-400 font-mono">{error}</p>
    </div>
  )

  // Same URL the "Edit Design" button uses — reused for the stepper's clickable
  // "Build It" step (back to the designer with the design intact).
  const editUrl = design
    ? `/designer?product_id=${design.shopify_product_id?.split('/').pop()}&variant_id=${design.shopify_variant_id?.split('/').pop()}&title=${encodeURIComponent(design.product_title || '')}&price=${((design.unit_price || 0) * 100).toFixed(0)}&design_id=${design.id}`
    : undefined

  return (
    <div className="min-h-screen bg-white text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-gray-200">
        <div className="font-black text-xl tracking-widest text-gray-900">
          <BrandMark />
        </div>
        <div className="w-32" />
      </header>

      {/* Progress strip — replaces the old inline "1.DESIGN → 2.QUANTITY & SIZES →
          3.REVIEW" (off-spec labels + a RED active step). Build It done (← designer)
          · Order It (here) · Pick Up/Ship (upcoming). */}
      <Stepper current={2} editHref={editUrl} />

      {/* Mobile: stack (previews + Edit Design first, then options); desktop: two columns. */}
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row gap-6 md:gap-8">
        {/* Left - Design Preview */}
        <div className="flex-1">
          <h2 className="text-lg font-bold font-mono mb-4">{t('order.your_design', 'Your Design')}</h2>
          {(() => {
            // Show the FRONT always, and the BACK whenever the product HAS a back side —
            // even if the customer left it blank — so the order makes it explicit what will
            // print (incl. "the back is blank"). Each PNG already has its own front/back shirt
            // image composited in (designer fix). (#4)
            if (!frontDesigned && !backDesigned && !hasAnyExtra) {
              return (
                <div className="aspect-square flex items-center justify-center text-gray-800 font-mono border border-gray-200 rounded-xl">
                  {t('order.no_preview', 'No preview available')}
                </div>
              )
            }
            const sides = [
              { key: 'front', display: t('order.side_front', 'FRONT'), src: design?.canvas_png_front ?? null, blank: !frontDesigned },
              (backDesigned || productHasBack) ? { key: 'back', display: t('order.side_back', 'BACK'), src: design?.canvas_png_back ?? null, blank: !backDesigned } : null,
              // Print Zones: a tile per extra zone that was actually designed (sleeves/hat).
              ...extraZones.filter(z => !!zoneMap[z]?.canvas_png).map(z => ({ key: z, display: zoneLabel(z).toUpperCase(), src: zoneMap[z]?.canvas_png ?? null, blank: false })),
            ].filter(Boolean) as { key: string; display: string; src: string | null; blank: boolean }[]
            return (
              <div className={sides.length > 1 ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'max-w-sm mx-auto'}>
                {sides.map(s => (
                  <div key={s.key} className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                    <p className="text-xs font-mono text-gray-900 px-3 pt-3">{s.display}</p>
                    {s.blank ? (
                      <div className="flex aspect-square items-center justify-center px-4 text-center text-sm font-mono text-gray-500">
                        {t('order.side_blank', 'No design on this side (blank)')}
                      </div>
                    ) : (
                      <img src={s.src!} alt={`Your design - ${s.display.toLowerCase()}`} className="w-full object-contain" />
                    )}
                  </div>
                ))}
              </div>
            )
          })()}
          {/* Edit design link */}
          <a href={editUrl}
            className="mt-4 inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-mono font-medium text-gray-900 hover:border-[#dd3333] hover:text-[#dd3333] transition-all">
            {t('order.edit_design', '← Edit Design')}
          </a>
        </div>

        {/* Right - Order Options */}
        <div className="w-full md:w-96 md:shrink-0 flex flex-col gap-6">

          {/* Product Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-1">{t('order.product_label', 'Product')}</p>
            <p className="text-lg font-bold text-gray-900">{design?.product_title}</p>
            <p className="text-sm text-gray-900 mt-1">{t('order.color_label', 'Color:')} {design?.selected_color}</p>
            <p className="text-sm text-gray-900">{t('order.method_label', 'Method:')} {(() => { const mk = 'method.' + (design?.print_method || 'screen_print'); const s = t(mk); return s === mk ? (design?.print_method || 'print').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : s })()}</p>
          </div>

          {/* Pricing */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-3">{t('order.pricing_label', 'Pricing')}</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-gray-900">
                <span>{t('order.blank_line')}</span>
                <span className="text-gray-900 font-medium">${design?.unit_price?.toFixed(2)}</span>
              </div>
              {frontCharge > 0 && (
                <div className="flex justify-between text-gray-900">
                  <span>{t('order.front_print', 'Front Print')}</span>
                  <span className="text-gray-900">+${frontCharge.toFixed(2)}</span>
                </div>
              )}
              {backCharge > 0 && (
                <div className="flex justify-between text-gray-900">
                  <span>{t('order.back_print', 'Back Print')}</span>
                  <span className="text-gray-900">+${backCharge.toFixed(2)}</span>
                </div>
              )}
              {/* Print Zones: one line per extra zone (sleeves/hat) that carries a charge. */}
              {extraZones.map(z => {
                const c = Number(zoneMap[z]?.print_charge) || 0
                return c > 0 ? (
                  <div key={z} className="flex justify-between text-gray-900">
                    <span>{format(t('order.zone_print', '{zone} Print'), { zone: zoneLabel(z) })}</span>
                    <span className="text-gray-900">+${c.toFixed(2)}</span>
                  </div>
                ) : null
              })}
              {nnActive && (
                <div className="flex justify-between text-gray-600 text-xs italic">
                  <span>{t('order.nn_personalization', 'Personalization (names & numbers)')}</span>
                  <span>{t('order.nn_included', 'included in print')}</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
                <span className="text-gray-900 font-bold">{t('order.price_per_item', 'Price per item')}</span>
                <span className="text-[#dd3333]">${pricePerItem.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Size Quantities — or, for a Names & Numbers order, the roster manifest (read-only: the
              list is edited in the designer, and it's the source of truth for who gets which shirt). */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-3">{nnActive ? t('order.nn_heading', 'Names & Numbers') : t('order.sizes_heading', 'Sizes & Quantities')}</p>
            {nnActive ? (
              <div className="flex flex-col">
                <div className="grid gap-2 border-b border-gray-200 pb-1 text-[10px] font-mono uppercase tracking-wide text-gray-500" style={{ gridTemplateColumns: nnGrid }}>
                  <span>{t('order.roster_name', 'Name')}</span><span>{t('order.roster_number', 'Number')}</span>{nnHasTitle && <span>{t('order.roster_title', 'Title')}</span>}<span>{t('order.roster_size', 'Size')}</span><span className="text-right">{t('order.roster_qty', 'Qty')}</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {rosterEntries.map((e, i) => (
                    <div key={i} className="grid items-center gap-2 border-b border-gray-100 py-1 text-sm text-gray-900 last:border-b-0" style={{ gridTemplateColumns: nnGrid }}>
                      <span className="truncate font-medium">{e.name || '—'}</span>
                      <span>{e.number || '—'}</span>
                      {nnHasTitle && <span className="truncate">{e.title || '—'}</span>}
                      <span className="whitespace-nowrap">{e.size || '—'}</span>
                      <span className="text-right">{e.qty}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">{t('order.roster_hint', 'Edit this list in the designer — it sets the shirts and quantities.')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedSizes.map(size => (
                  <div key={size} className="flex items-center justify-between gap-3">
                    {/* FIXED width (not min-w) so every size label occupies the same column and the
                        steppers line up across rows — a onesie's longer labels ("12-24mo") would
                        otherwise widen just that row and push its stepper out (Denise #17). w-20 fits
                        the longest onesie/adult label; shrink-0 + nowrap prevent shrinking/wrapping. */}
                    <span className="text-sm font-mono text-gray-900 font-semibold w-20 shrink-0 whitespace-nowrap">{size}</span>
                    <div className="flex items-center gap-3 bg-white border border-[#333] rounded-lg px-3 py-1.5">
                      <button onClick={() => setQuantities(q => ({ ...q, [size]: Math.max(0, (q[size] || 0) - 1) }))}
                        className="text-gray-900 hover:text-[#dd3333] font-bold w-5 text-center text-lg leading-none">−</button>
                      <span className="text-sm font-mono w-5 text-center text-gray-900 font-bold">{quantities[size] || 0}</span>
                      <button onClick={() => setQuantities(q => ({ ...q, [size]: (q[size] || 0) + 1 }))}
                        className="text-gray-900 hover:text-[#dd3333] font-bold w-5 text-center text-lg leading-none">+</button>
                    </div>
                    <span className="text-xs text-gray-800 font-mono w-16 text-right">
                      {quantities[size] > 0 ? `$${(quantities[size] * pricePerItem).toFixed(2)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Totals */}
            <div className="border-t border-gray-200 mt-4 pt-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm text-gray-900">
                <span>{t('order.total_quantity', 'Total quantity')}</span>
                <span className="text-gray-900">{totalQty}</span>
              </div>
              <div className="flex justify-between">
                <span className={activeTier ? 'text-gray-500' : 'text-gray-900 font-bold'}>
                  {activeTier ? t('order.subtotal_before_discount', 'Subtotal (before discount)') : t('order.order_total', 'Order total')}
                </span>
                <span className={activeTier ? 'text-gray-500 line-through' : 'text-[#dd3333] text-lg font-bold'}>${total}</span>
              </div>
            </div>

            {/* Volume savings — INCENTIVE display only, for THIS garment's ladder (per-product). The
                actual % comes off at checkout via the Shopify discount Function; this shows the ladder +
                a "one more to save" nudge so the customer knows it's there. Gated by VOLUME_DISCOUNT.enabled
                (never promise a discount before the Function is live) AND this garment having tiers. */}
            {VOLUME_DISCOUNT.enabled && volumeTiers.length > 0 && (() => {
              const cur = currentTier(totalQty, volumeTiers)
              const nxt = nextTier(totalQty, volumeTiers)
              // Same math the Shopify Function runs: cur = highest minQty met (identical rule),
              // applied to this design's line subtotal (totalQty × pricePerItem, where the design
              // product's variant IS priced at pricePerItem). So the −$ shown here matches checkout,
              // modulo post-add cart quantity edits + per-line cent rounding → labeled "Estimated".
              const discountAmt = cur ? (totalQty * pricePerItem * cur.pct) / 100 : 0
              const estTotal = totalQty * pricePerItem - discountAmt
              return (
                <div className="border-t border-gray-200 mt-4 pt-4">
                  <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-2">{t('order.volume_savings', 'Volume savings')}</p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {volumeTiers.map(tier => {
                      const active = cur?.minQty === tier.minQty
                      return (
                        <span key={tier.minQty}
                          className={`rounded-full border px-2.5 py-1 text-xs font-mono ${
                            active ? 'border-[#dd3333] bg-red-50 text-[#dd3333] font-bold' : 'border-gray-200 bg-white text-gray-600'
                          }`}>
                          {tier.minQty}+ {t('order.volume_tier_save', 'save')} {tier.pct}%
                        </span>
                      )
                    })}
                  </div>
                  {nxt ? (
                    <p className="text-sm font-bold text-[#dd3333]">
                      {t('order.volume_add', 'Add')} <span className="font-bold">{nxt.needed}</span> {t('order.volume_more_to_save', 'more to save')} <span className="font-bold">{nxt.tier.pct}%</span> {t('order.volume_on_order', 'on your order.')}
                    </p>
                  ) : cur ? (
                    <p className="text-sm font-bold text-[#dd3333]">{t('order.volume_youre_getting', 'You’re getting')} <span className="font-bold">{cur.pct}{t('order.volume_pct_off', '% off')}</span> {t('order.volume_top_tier', '— the top tier. 🎉')}</p>
                  ) : null}
                  {cur && (
                    <div className="mt-3 flex flex-col gap-1.5">
                      <div className="flex justify-between text-sm font-bold text-[#dd3333]">
                        <span>{t('order.volume_discount_line', 'Volume discount')} ({cur.pct}%)</span>
                        <span>−${discountAmt.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold text-gray-900">
                        <span>{t('order.volume_estimated_total', 'Estimated total')}</span>
                        <span>${estTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-sm text-gray-700">{t('order.volume_auto_checkout', 'Discount applied automatically in your cart.')}</p>
                </div>
              )
            })()}
          </div>

          {/* Desired-by date (BETA #30) — optional; method-aware turnaround note + a SOFT nudge if the
              date is sooner than turnaround. Never blocks checkout. Saved to the order → admin + OrderInfo. */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <label htmlFor="desired-by" className="block text-xs font-mono text-gray-900 uppercase tracking-widest mb-2">
              {t('order.desired_by_label', 'Desired by')} <span className="text-gray-500 normal-case">{t('order.notes_optional', '(optional)')}</span>
            </label>
            <input
              id="desired-by"
              type="date"
              value={desiredBy}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDesiredBy(e.target.value)}
              className="w-full sm:w-56 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333]"
            />
            <p className="mt-2 text-xs text-gray-500">
              {design?.print_method === 'embroidery'
                ? t('order.desired_by_help_embroidery', 'Typical turnaround: embroidery about a week.')
                : t('order.desired_by_help_print', 'Typical turnaround: print 24–72 hours.')}
            </p>
            {(() => {
              if (!desiredBy) return null
              const d = new Date(desiredBy + 'T00:00:00'); if (isNaN(d.getTime())) return null
              const days = design?.print_method === 'embroidery' ? 7 : 3
              const threshold = new Date(); threshold.setHours(0, 0, 0, 0); threshold.setDate(threshold.getDate() + days)
              if (d >= threshold) return null
              return (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t('order.desired_by_nudge', "That's sooner than our usual turnaround — we'll do our best, but please call us to confirm.")}
                </div>
              )
            })()}
          </div>

          {/* Design Notes — printing details for the shop; saved to the order
              and surfaced in admin. */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <label htmlFor="design-notes" className="block text-xs font-mono text-gray-900 uppercase tracking-widest mb-2">
              {t('order.notes_label', 'Design Notes')} <span className="text-gray-500 normal-case">{t('order.notes_optional', '(optional)')}</span>
            </label>
            <textarea
              id="design-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder={t('order.notes_placeholder', 'Printing details for our team — e.g. exact ink color, placement notes…')}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] resize-y placeholder-gray-400"
            />
          </div>

          {/* Names & Numbers size mismatch — explain instead of a silent $0 / dead button. */}
          {nnActive && badRosterSizes.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {format(t('order.nn_bad_sizes', "Some roster rows use a size this product doesn't offer ({sizes}). Go back to Edit Design to fix those sizes before checkout."), { sizes: badRosterSizes.join(', ') })}
            </div>
          )}

          {/* Error */}
          {error && <p className="text-red-400 text-sm font-mono text-center">{error}</p>}

          {/* BETA #32 — pre-cart design acknowledgment. Must be ACTIVELY checked (never pre-ticked); Add to
              Cart stays disabled until it is, and the checked state is saved onto the order as dated proof. */}
          <label className="flex items-start gap-3 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#dd3333] cursor-pointer" />
            <span className="text-xs leading-relaxed text-gray-700">
              {t('order.ack_label', "I've double-checked my design — spelling, image quality, and placement. What I see on screen is exactly what T-Shirt Deli will be cooking up, and they can't fix errors in my artwork or text after I order. For the sharpest print, I'm using high-resolution images.")}
            </span>
          </label>

          {/* Add to Cart — lands in the customer's real storefront cart,
              alongside other designs and off-the-shelf products */}
          <button onClick={() => handleAddToCart()} disabled={adding || totalQty === 0 || !acknowledged || (nnActive && badRosterSizes.length > 0)}
            className="w-full py-4 rounded-xl bg-[#dd3333] text-white font-black text-lg tracking-wide hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {adding
              ? <span className="inline-flex items-center justify-center gap-2"><Spinner size={16} />{t('order.adding_to_cart', 'Adding to Cart...')}</span>
              : `${t('order.add_to_cart', 'Add to Cart →')} ${totalQty > 0 ? `(${totalQty} item${totalQty > 1 ? 's' : ''})` : ''}`}
          </button>

          <p className="text-xs text-gray-800 font-mono text-center">
            {t('order.keep_shopping', 'Keep shopping or check out from your cart when you\'re ready')}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function OrderPageWrapper() {
  return <Suspense><OrderPage /></Suspense>
}
