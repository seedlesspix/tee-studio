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
  
  // Safely decode title - handle any encoding issues
  let title = 'Custom Product'
  try {
    const raw = searchParams.get('title') || ''
    title = decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    title = searchParams.get('title') || 'Custom Product'
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#0d0d0d]">
      <DesignerCanvas
        productId={productId}
        variantId={variantId}
        productTitle={title}
        productPrice={parseInt(price) / 100}
        designId={designId}
        restoreId={restoreId}
        initialQuantity={quantity}
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