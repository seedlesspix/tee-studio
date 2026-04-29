'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { createShopifyCart } from '../lib/shopify'

const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']

interface DesignOrder {
  id: string
  product_title: string
  selected_color: string
  shopify_variant_id: string
  shopify_product_id: string
  canvas_png_front: string
  canvas_png_back: string | null
  unit_price: number
  print_charge: number
  price_per_item: number
  sides_designed: number
  print_method: string
  quantities: Record<string, number>
}

function OrderPage() {
  const searchParams = useSearchParams()
  const designId = searchParams.get('design_id')
  const [design, setDesign] = useState<DesignOrder | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!designId) return
    supabase.from('design_orders').select('*').eq('id', designId).single()
      .then(({ data, error }) => {
        if (error || !data) { setError('Design not found'); setLoading(false); return }
        setDesign(data)
        const initQty: Record<string, number> = {}
        SIZES.forEach(s => initQty[s] = data.quantities?.[s] || 0)
        setQuantities(initQty)
        setLoading(false)
      })
  }, [designId])

  const totalQty = Object.values(quantities).reduce((a, b) => a + b, 0)
  const pricePerItem = design ? (design.unit_price + design.print_charge) : 0
  const discount = totalQty >= 24 ? 0.20 : totalQty >= 12 ? 0.15 : totalQty >= 6 ? 0.10 : 0
  const total = (totalQty * pricePerItem * (1 - discount)).toFixed(2)

  const handleAddToCart = async () => {
    if (!design || totalQty === 0) { setError('Please select at least one size and quantity.'); return }
    setAdding(true)
    setError('')

    // Update design order with final quantities
    await supabase.from('design_orders').update({
      quantities,
      total_qty: totalQty,
      total_price: parseFloat(total),
      status: 'ordering'
      }).eq('id', design.id)

    // Create Shopify cart
    const variantId = design.shopify_variant_id?.split('/').pop() || ''
    const cart = await createShopifyCart(
      variantId,
      quantities,
      design.id,
      design.print_charge,
      design.selected_color
    )

    if (cart?.checkoutUrl) {
      await supabase.from('design_orders').update({
        shopify_cart_url: cart.checkoutUrl,
        status: 'cart_created'
      }).eq('id', design.id)
      // Go to cart page not checkout - use checkoutUrl as-is
      // Shopify checkoutUrl format: https://tshirtdeli.com/cart/c/TOKEN
      // which already shows the cart, not checkout
      window.location.href = cart.checkoutUrl
    } else {
      setError('Failed to create cart. Please try again.')
      setAdding(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-white font-mono">Loading your design...</p>
    </div>
  )

  if (error && !design) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <p className="text-red-400 font-mono">{error}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 bg-[#161616] border-b border-[#2a2a2a]">
        <div className="font-black text-xl tracking-widest">
          TEE<span className="text-[#e8ff47]">STUDIO</span>
        </div>
        {/* Steps */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-gray-500">1. DESIGN</span>
          <span className="text-gray-600">→</span>
          <span className="text-[#e8ff47] font-bold">2. QUANTITY & SIZES</span>
          <span className="text-gray-600">→</span>
          <span className="text-gray-500">3. REVIEW</span>
        </div>
        <div className="w-32" />
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 flex gap-8">
        {/* Left - Design Preview */}
        <div className="flex-1">
          <h2 className="text-lg font-bold font-mono mb-4">Your Design</h2>
          <div className="bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden">
            {design?.canvas_png_front ? (
              <img src={design.canvas_png_front} alt="Your design - front"
                className="w-full object-contain" />
            ) : (
              <div className="aspect-square flex items-center justify-center text-gray-600 font-mono">
                No preview available
              </div>
            )}
          </div>
          {design?.canvas_png_back && (
            <div className="mt-4 bg-[#111] border border-[#2a2a2a] rounded-xl overflow-hidden">
              <p className="text-xs font-mono text-gray-500 px-3 pt-3">BACK</p>
              <img src={design.canvas_png_back} alt="Your design - back"
                className="w-full object-contain" />
            </div>
          )}
          {/* Edit design link */}
          <a href={`/designer?product_id=${design?.shopify_product_id?.split('/').pop()}&variant_id=${design?.shopify_variant_id?.split('/').pop()}&title=${encodeURIComponent(design?.product_title || '')}&price=${((design?.unit_price || 0) * 100).toFixed(0)}&design_id=${design?.id}`}
            className="mt-4 inline-block text-xs font-mono text-gray-500 hover:text-[#e8ff47] transition-all underline">
            ← Edit Design
          </a>
        </div>

        {/* Right - Order Options */}
        <div className="w-96 shrink-0 flex flex-col gap-6">

          {/* Product Info */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-1">Product</p>
            <p className="font-bold">{design?.product_title}</p>
            <p className="text-sm text-gray-400 mt-1">Color: {design?.selected_color}</p>
            <p className="text-sm text-gray-400">Print: {design?.print_method?.replace('_', ' ')}</p>
          </div>

          {/* Pricing */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Pricing</p>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Blank shirt</span>
                <span className="text-white">${design?.unit_price?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Print charge ({design?.sides_designed} side{(design?.sides_designed || 0) > 1 ? 's' : ''})</span>
                <span className="text-white">+${design?.print_charge?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold border-t border-[#2a2a2a] pt-2">
                <span>Price per item</span>
                <span className="text-[#e8ff47]">${pricePerItem.toFixed(2)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-400 text-xs">
                  <span>Volume discount ({(discount * 100).toFixed(0)}% off)</span>
                  <span>-${(totalQty * pricePerItem * discount).toFixed(2)}</span>
                </div>
              )}
            </div>
            {/* Discount tiers */}
            <div className="mt-3 bg-[#0a0a0a] rounded-lg p-3 text-[10px] font-mono text-gray-600 flex flex-col gap-1">
              <div className={totalQty >= 6 ? 'text-[#e8ff47]' : ''}>6+ shirts: 10% off</div>
              <div className={totalQty >= 12 ? 'text-[#e8ff47]' : ''}>12+ shirts: 15% off</div>
              <div className={totalQty >= 24 ? 'text-[#e8ff47]' : ''}>24+ shirts: 20% off</div>
            </div>
          </div>

          {/* Size Quantities */}
          <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Sizes & Quantities</p>
            <div className="flex flex-col gap-2">
              {SIZES.map(size => (
                <div key={size} className="flex items-center justify-between">
                  <span className="text-sm font-mono text-gray-300 w-10">{size}</span>
                  <div className="flex items-center gap-3 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-1.5">
                    <button onClick={() => setQuantities(q => ({ ...q, [size]: Math.max(0, (q[size] || 0) - 1) }))}
                      className="text-gray-400 hover:text-[#e8ff47] font-bold w-5 text-center text-lg leading-none">−</button>
                    <span className="text-sm font-mono w-5 text-center">{quantities[size] || 0}</span>
                    <button onClick={() => setQuantities(q => ({ ...q, [size]: (q[size] || 0) + 1 }))}
                      className="text-gray-400 hover:text-[#e8ff47] font-bold w-5 text-center text-lg leading-none">+</button>
                  </div>
                  <span className="text-xs text-gray-600 font-mono w-16 text-right">
                    {quantities[size] > 0 ? `$${(quantities[size] * pricePerItem).toFixed(2)}` : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-[#2a2a2a] mt-4 pt-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm text-gray-400">
                <span>Total quantity</span>
                <span className="text-white">{totalQty}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Order total</span>
                <span className="text-[#e8ff47] text-lg">${total}</span>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-red-400 text-sm font-mono text-center">{error}</p>}

          {/* Add to Cart Button */}
          <button onClick={handleAddToCart} disabled={adding || totalQty === 0}
            className="w-full py-4 rounded-xl bg-[#e8ff47] text-black font-black text-lg tracking-wide hover:bg-yellow-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {adding ? 'Adding to Cart...' : `Add to Cart → ${totalQty > 0 ? `(${totalQty} item${totalQty > 1 ? 's' : ''})` : ''}`}
          </button>

          <p className="text-xs text-gray-600 font-mono text-center">
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
