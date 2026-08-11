'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import DesignerCanvas from '../components/DesignerCanvas'

function DesignerContent() {
  const searchParams = useSearchParams()
  
  const productId = searchParams.get('product_id') || ''
  const variantId = searchParams.get('variant_id') || ''
  const price = searchParams.get('price') || '0'
  const quantity = searchParams.get('quantity') || ''
  const designId = searchParams.get('design_id') || ''
  // Set when returning from a Shopify login round-trip: the id of the draft
  // snapshotted before the redirect, to rehydrate the canvas.
  const restoreId = searchParams.get('restore') || ''
  // D2 Design Portability: the design_id design was made on a DIFFERENT product — re-fit it onto this
  // product on open ("Use on another product") instead of a plain edit-restore.
  const refit = searchParams.get('refit') === '1'
  // D2 color reconcile: preferred color carried from the ported design (used when no variant pins one).
  const initialColor = searchParams.get('color') || ''
  // Edit-from-cart (item 28): the design_order id whose existing cart line(s) this edit should replace
  // on finish (carried through to the order page's add-to-cart as replaceDesignOrderId).
  const replaceCart = searchParams.get('replace_cart') || ''
  // …and the exact cart line KEY to remove first-party on finish (seamless replace, no duplicate line).
  const replaceLine = searchParams.get('replace_line') || ''
  
  // Safely decode title - handle any encoding issues
  let title = 'Custom Product'
  try {
    const raw = searchParams.get('title') || ''
    title = decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    title = searchParams.get('title') || 'Custom Product'
  }

  return (
    <main className="w-screen lg:h-screen lg:overflow-hidden bg-[#0d0d0d]">
      <DesignerCanvas
        productId={productId}
        variantId={variantId}
        productTitle={title}
        productPrice={parseInt(price) / 100}
        designId={designId}
        restoreId={restoreId}
        initialQuantity={quantity}
        refit={refit}
        initialColor={initialColor}
        replaceCart={replaceCart}
        replaceLine={replaceLine}
      />
    </main>
  )
}

export default function DesignerPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-screen flex items-center justify-center bg-[#0d0d0d] text-white">
        Loading designer...
      </div>
    }>
      <DesignerContent />
    </Suspense>
  )
}