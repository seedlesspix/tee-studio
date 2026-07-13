'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { addItemsToShopifyCart, getStoreOrigin, resolvePrintChargeVariant, type CartItem } from '../lib/shopify'
import type { Tables } from '@/types/database'

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']

type DesignOrder = Omit<Tables<'design_orders'>, 'quantities'> & {
  quantities: Record<string, number> | null
}

function OrderPage() {
  const searchParams = useSearchParams()
  const designId = searchParams.get('design_id')
  const [design, setDesign] = useState<DesignOrder | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!designId) return
    supabase.from('design_orders').select('*').eq('id', designId).single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Design not found'); setLoading(false); return }
        const order = data as DesignOrder
        setDesign(order)
        setNotes(order.notes ?? '')
        const initQty: Record<string, number> = {}
        const savedQuantities = order.quantities ?? {}
        // Use available_sizes from product, or fall back to saved quantities
        const sizesToUse: string[] =
          (order.available_sizes?.length ?? 0) > 0
            ? order.available_sizes!
            : Object.keys(savedQuantities).length > 0
              ? Object.keys(savedQuantities)
              : ALL_SIZES
        sizesToUse.forEach((s) => { initQty[s] = savedQuantities[s] ?? 0 })
        setQuantities(initQty)
        setLoading(false)
      })
  }, [designId])

  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']
  const sortedSizes = Object.keys(quantities).sort(
    (a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b)
  )
  const totalQty = Object.values(quantities).reduce((a, b) => a + b, 0)
  const pricePerItem = design ? ((design.unit_price ?? 0) + (design.print_charge ?? 0)) : 0
  const total = (totalQty * pricePerItem).toFixed(2)

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

  const handleAddToCart = async () => {
    if (!design || totalQty === 0) { setError('Please select at least one size and quantity.'); return }
    setAdding(true)
    setError('')

    // 1. Persist the chosen quantities and total to design_orders (status: ordering)
    await supabase.from('design_orders').update({
      quantities,
      total_qty: totalQty,
      total_price: parseFloat(total),
      notes: notes.trim() || null,
      status: 'ordering',
    }).eq('id', design.id)

    // 2. Build line items for Shopify — one per non-zero size
    const variantId = design.shopify_variant_id?.split('/').pop() || ''
    const baseProps: Record<string, string> = {
      _design_order_id: design.id,
      _print_charge: `$${(design.print_charge ?? 0).toFixed(2)}`,
      _color: design.selected_color ?? '',
      'Custom Design': 'Yes',
    }
    if (design.canvas_png_front) baseProps._design_preview_front = design.canvas_png_front
    if (design.canvas_png_back)  baseProps._design_preview_back  = design.canvas_png_back

    const items: CartItem[] = Object.entries(quantities)
      .filter(([_, qty]) => qty > 0)
      .map(([size, qty]) => ({
        variantId,
        quantity: qty,
        properties: { ...baseProps, _size: size },
      }))

    // 3. Add Print Charge line items for screen_print designs.
    //    - Embroidery (and any non-screen_print method): skip entirely. The
    //      surcharge is baked into the base product price for those today.
    //      To activate: see CLAUDE.md "designer_pricing operational rules".
    //    - One Print Charge per side that has rendered content
    //      (canvas_png_front / canvas_png_back). Front-only products like
    //      hats naturally only get a Front Print charge.
    //    - Quantity = total shirts (the surcharge is per shirt, not per size).
    //    - Resolve ALL variants before adding any line items so a missing
    //      variant fails loud without leaving the cart half-populated.
    if (design.print_method === 'screen_print') {
      const printChargeProps: Record<string, string> = {
        _design_order_id: design.id,
        _for_design: design.product_title ?? '',
      }

      if (design.canvas_png_front) {
        const front = await resolvePrintChargeVariant('screen_print', 1)
        if (!front.ok) { setError(front.error); setAdding(false); return }
        items.push({
          variantId: front.variantId,
          quantity: totalQty,
          properties: { ...printChargeProps, _side: 'Front' },
        })
      }

      if (design.canvas_png_back) {
        const back = await resolvePrintChargeVariant('screen_print', 2)
        if (!back.ok) { setError(back.error); setAdding(false); return }
        items.push({
          variantId: back.variantId,
          quantity: totalQty,
          properties: { ...printChargeProps, _side: 'Back' },
        })
      }
    }

    // 4. Add to the customer's Shopify session cart via /cart/add.js
    const result = await addItemsToShopifyCart(items)

    if (!result.ok) {
      setError(`Could not add to cart: ${result.error}`)
      setAdding(false)
      return
    }

    // 4. Mark order as cart_created. shopify_cart_url is now NULL — the AJAX
    //    endpoint doesn't give us a per-cart URL; the cart lives in cookies.
    await supabase.from('design_orders').update({
      status: 'cart_created',
      shopify_cart_url: null,
    }).eq('id', design.id)

    // 5. Redirect to the storefront cart page
    let storeOrigin: string
    try {
      storeOrigin = getStoreOrigin()
    } catch {
      // We just succeeded with addItemsToShopifyCart, so this shouldn't fire,
      // but fall back to the bare /cart path rather than crashing.
      storeOrigin = ''
    }
    window.location.href = `${storeOrigin}/cart`
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

  return (
    <div className="min-h-screen bg-white text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-gray-200">
        <div className="font-black text-xl tracking-widest">
          TEE<span className="text-[#dd3333]">STUDIO</span>
        </div>
        {/* Steps */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-gray-900">1. DESIGN</span>
          <span className="text-gray-800">→</span>
          <span className="text-[#dd3333] font-bold">2. QUANTITY & SIZES</span>
          <span className="text-gray-800">→</span>
          <span className="text-gray-900">3. REVIEW</span>
        </div>
        <div className="w-32" />
      </header>

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
          <a href={`/designer?product_id=${design?.shopify_product_id?.split('/').pop()}&variant_id=${design?.shopify_variant_id?.split('/').pop()}&title=${encodeURIComponent(design?.product_title || '')}&price=${((design?.unit_price || 0) * 100).toFixed(0)}&design_id=${design?.id}`}
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
            <p className="text-sm text-gray-900">Print: {design?.print_method?.replace('_', ' ')}</p>
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
              <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
                <span className="text-gray-900 font-bold">Price per item</span>
                <span className="text-[#dd3333]">${pricePerItem.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Size Quantities */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-mono text-gray-900 uppercase tracking-widest mb-3">Sizes & Quantities</p>
            <div className="flex flex-col gap-2">
              {sortedSizes.map(size => (
                <div key={size} className="flex items-center justify-between">
                  <span className="text-sm font-mono text-gray-900 font-semibold w-10">{size}</span>
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

          {/* Add to Cart Button */}
          <button onClick={handleAddToCart} disabled={adding || totalQty === 0}
            className="w-full py-4 rounded-xl bg-[#dd3333] text-white font-black text-lg tracking-wide hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {adding ? 'Adding to Cart...' : `Add to Cart → ${totalQty > 0 ? `(${totalQty} item${totalQty > 1 ? 's' : ''})` : ''}`}
          </button>

          <p className="text-xs text-gray-800 font-mono text-center">
            You'll be able to review your order before checkout
          </p>
        </div>
      </div>
    </div>
  )
}

export default function OrderPageWrapper() {
  return <Suspense><OrderPage /></Suspense>
}
