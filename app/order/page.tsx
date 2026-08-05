'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Tables } from '@/types/database'
import { type RosterEntry } from '@/app/lib/namesNumbers'
import Stepper from '@/app/components/Stepper'

type DesignOrder = Omit<Tables<'design_orders'>, 'quantities'> & {
  quantities: Record<string, number> | null
}

function OrderPage() {
  const searchParams = useSearchParams()
  const designId = searchParams.get('design_id')
  const [design, setDesign] = useState<DesignOrder | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // Sizes in Shopify variant order (from the design's available_sizes) — the
  // merchant's intended display order, never alphabetized or a hardcoded list.
  const [orderedSizes, setOrderedSizes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!designId) return
    // BLOCKER-1 lockdown: reads flow through the server route (service role)
    // — the public RLS read policy is gone. Same URL-as-key semantics.
    fetch(`/api/design-orders/${designId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        const data = payload?.order as DesignOrder | undefined
        if (!data) { setError('Design not found'); setLoading(false); return }
        const order = data
        setDesign(order)
        setNotes(order.notes ?? '')
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
      })
  }, [designId])

  // Render in Shopify variant order (orderedSizes) — no alphabetical/hardcoded
  // sort, which would scramble both "3-6mo, 6-12mo" and "S, M, L".
  const sortedSizes = orderedSizes
  const totalQty = Object.values(quantities).reduce((a, b) => a + b, 0)
  const pricePerItem = design ? ((design.unit_price ?? 0) + (design.print_charge ?? 0)) : 0
  const total = (totalQty * pricePerItem).toFixed(2)

  // Names & Numbers: the saved roster is this order's source of truth for who gets which shirt. Its
  // size/qty aggregate is already what we loaded into `quantities`, so the total math is unchanged;
  // for N&N we show the roster manifest (read-only) instead of the size steppers. Personalization is
  // Option 1 — the printed side, already inside the per-side print charge — so no separate line adds
  // money; we just note it's included.
  const rosterEntries: RosterEntry[] = Array.isArray(design?.roster) ? (design!.roster as unknown as RosterEntry[]) : []
  const nnActive = rosterEntries.length > 0

  // Per-side print-charge split. Read the exact captured columns (Day-4). Fall
  // back to deriving from side presence for legacy rows saved before the split
  // was captured (those have null print_charge_front/back).
  const printChargeTotal = design?.print_charge ?? 0
  const frontDesigned = !!design?.canvas_png_front
  const backDesigned = !!design?.canvas_png_back
  const bothSides = frontDesigned && backDesigned
  const frontCharge = design?.print_charge_front
    ?? (frontDesigned ? (bothSides ? printChargeTotal / 2 : printChargeTotal) : 0)
  const backCharge = design?.print_charge_back
    ?? (backDesigned ? (bothSides ? printChargeTotal / 2 : printChargeTotal) : 0)

  // Phase 4 Day 6 (revised): one call renders the design as an ephemeral
  // Shopify product (per-size variants at the folded per-shirt price) and
  // joins it to the CUSTOMER'S REAL storefront cart — where it mixes with
  // other designs and off-the-shelf products for one checkout, done natively
  // from /cart when they finish shopping. One honest line per size; the old
  // Print Charge line-item machinery stays gone.
  const handleAddToCart = async () => {
    if (!design || totalQty === 0) { setError('Please select at least one size and quantity.'); return }
    setAdding(true)
    setError('')

    const res = await fetch(`/api/design-orders/${design.id}/add-to-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantities, notes: notes.trim() || null }),
    }).catch(() => null)

    if (!res || !res.ok) {
      const detail = res ? await res.json().catch(() => null) : null
      setError(detail?.error ?? 'Could not add to cart — please try again.')
      setAdding(false)
      return
    }

    const { cartUrl } = (await res.json()) as { cartUrl: string }
    window.location.href = cartUrl
  }

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-white font-mono">Loading your design...</p>
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
        <div className="font-black text-xl tracking-widest">
          TEE<span className="text-[#dd3333]">STUDIO</span>
        </div>
        <div className="w-32" />
      </header>

      {/* Progress strip — replaces the old inline "1.DESIGN → 2.QUANTITY & SIZES →
          3.REVIEW" (off-spec labels + a RED active step). Build It done (← designer)
          · Order It (here) · Pick Up/Ship (upcoming). */}
      <Stepper current={2} editHref={editUrl} />

      <div className="max-w-6xl mx-auto px-6 py-8 flex gap-8">
        {/* Left - Design Preview */}
        <div className="flex-1">
          <h2 className="text-lg font-bold font-mono mb-4">Your Design</h2>
          {(() => {
            // One designed side → a single centered, smaller preview (no blank-
            // side noise). Both sides → a side-by-side pair. Each PNG already
            // has its own front/back shirt image composited in (designer fix).
            const sides = [
              design?.canvas_png_front && { src: design.canvas_png_front, label: 'FRONT' },
              design?.canvas_png_back && { src: design.canvas_png_back, label: 'BACK' },
            ].filter(Boolean) as { src: string; label: string }[]
            if (sides.length === 0) {
              return (
                <div className="aspect-square flex items-center justify-center text-gray-800 font-mono border border-gray-200 rounded-xl">
                  No preview available
                </div>
              )
            }
            return (
              <div className={sides.length === 2 ? 'grid grid-cols-2 gap-4' : 'max-w-xs mx-auto'}>
                {sides.map(s => (
                  <div key={s.label} className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                    <p className="text-xs font-mono text-gray-900 px-3 pt-3">{s.label}</p>
                    <img src={s.src} alt={`Your design - ${s.label.toLowerCase()}`} className="w-full object-contain" />
                  </div>
                ))}
              </div>
            )
          })()}
          {/* Edit design link */}
          <a href={editUrl}
            className="mt-4 inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-mono font-medium text-gray-900 hover:border-[#dd3333] hover:text-[#dd3333] transition-all">
            ← Edit Design
          </a>
        </div>

        {/* Right - Order Options */}
        <div className="w-96 shrink-0 flex flex-col gap-6">

          {/* Product Info */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-1">Product</p>
            <p className="text-lg font-bold text-gray-900">{design?.product_title}</p>
            <p className="text-sm text-gray-900 mt-1">Color: {design?.selected_color}</p>
            <p className="text-sm text-gray-900">Method: {design?.print_method === 'screen_print' ? 'Print' : (design?.print_method?.replace('_', ' ') || 'Print')}</p>
          </div>

          {/* Pricing */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-3">Pricing</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-gray-900">
                <span>Blank shirt</span>
                <span className="text-gray-900 font-medium">${design?.unit_price?.toFixed(2)}</span>
              </div>
              {frontCharge > 0 && (
                <div className="flex justify-between text-gray-900">
                  <span>Front Print</span>
                  <span className="text-gray-900">+${frontCharge.toFixed(2)}</span>
                </div>
              )}
              {backCharge > 0 && (
                <div className="flex justify-between text-gray-900">
                  <span>Back Print</span>
                  <span className="text-gray-900">+${backCharge.toFixed(2)}</span>
                </div>
              )}
              {nnActive && (
                <div className="flex justify-between text-gray-600 text-xs italic">
                  <span>Personalization (names &amp; numbers)</span>
                  <span>included in print</span>
                </div>
              )}
              <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
                <span className="text-gray-900 font-bold">Price per item</span>
                <span className="text-[#dd3333]">${pricePerItem.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Size Quantities — or, for a Names & Numbers order, the roster manifest (read-only: the
              list is edited in the designer, and it's the source of truth for who gets which shirt). */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-3">{nnActive ? 'Names & Numbers' : 'Sizes & Quantities'}</p>
            {nnActive ? (
              <div className="flex flex-col">
                <div className="grid grid-cols-[1fr_44px_52px_32px] gap-2 border-b border-gray-200 pb-1 text-[10px] font-mono uppercase tracking-wide text-gray-500">
                  <span>Name</span><span>Number</span><span>Size</span><span className="text-right">Qty</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {rosterEntries.map((e, i) => (
                    <div key={i} className="grid grid-cols-[1fr_44px_52px_32px] items-center gap-2 border-b border-gray-100 py-1 text-sm text-gray-900 last:border-b-0">
                      <span className="truncate font-medium">{e.name || '—'}</span>
                      <span>{e.number || '—'}</span>
                      <span className="whitespace-nowrap">{e.size || '—'}</span>
                      <span className="text-right">{e.qty}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-gray-500">Edit this list in the designer — it sets the shirts and quantities.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedSizes.map(size => (
                  <div key={size} className="flex items-center justify-between gap-3">
                    {/* min-w keeps adult sizes aligned in a column; shrink-0 +
                        nowrap stop multi-character names ("12-18MO") wrapping at
                        the hyphen. w-10 was sized for single-character sizes. */}
                    <span className="text-sm font-mono text-gray-900 font-semibold min-w-[2.5rem] shrink-0 whitespace-nowrap">{size}</span>
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
                <span>Total quantity</span>
                <span className="text-gray-900">{totalQty}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-gray-900 font-bold">Order total</span>
                <span className="text-[#dd3333] text-lg">${total}</span>
              </div>
            </div>
          </div>

          {/* Design Notes — printing details for the shop; saved to the order
              and surfaced in admin. */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <label htmlFor="design-notes" className="block text-xs font-mono text-gray-900 uppercase tracking-widest mb-2">
              Design Notes <span className="text-gray-500 normal-case">(optional)</span>
            </label>
            <textarea
              id="design-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Printing details for our team — e.g. exact ink color, placement notes…"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] resize-y placeholder-gray-400"
            />
          </div>

          {/* Error */}
          {error && <p className="text-red-400 text-sm font-mono text-center">{error}</p>}

          {/* Add to Cart — lands in the customer's real storefront cart,
              alongside other designs and off-the-shelf products */}
          <button onClick={handleAddToCart} disabled={adding || totalQty === 0}
            className="w-full py-4 rounded-xl bg-[#dd3333] text-white font-black text-lg tracking-wide hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {adding ? 'Adding to Cart...' : `Add to Cart → ${totalQty > 0 ? `(${totalQty} item${totalQty > 1 ? 's' : ''})` : ''}`}
          </button>

          <p className="text-xs text-gray-800 font-mono text-center">
            Keep shopping or check out from your cart when you&apos;re ready
          </p>
        </div>
      </div>
    </div>
  )
}

export default function OrderPageWrapper() {
  return <Suspense><OrderPage /></Suspense>
}
