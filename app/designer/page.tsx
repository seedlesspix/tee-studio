'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import DesignerCanvas, { type PlaceDecal } from '../components/DesignerCanvas'

// Grab 'n Go deep link (2026-10-16): what /api/deep-link resolves ?design= / ?garment= into.
type DeepLinkResolved = {
  design: PlaceDecal | null
  garment: { templateId: string; productId: string; gid: string; title: string; matched: boolean; color: string | null } | null
}

function Loading() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0d0d0d] text-white">
      Loading designer...
    </div>
  )
}

function DesignerContent() {
  const searchParams = useSearchParams()
  
  const productIdParam = searchParams.get('product_id') || ''
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
  // Grab 'n Go deep link: ?design=T2491 (the Art library design number) places that design on open;
  // ?garment=3001 (a template style number) picks the garment, else the default garment + the picker.
  // An edit / restore owns the canvas, so the deep link is ignored alongside design_id / restore.
  const designParam = searchParams.get('design') || ''
  const garmentParam = searchParams.get('garment') || ''
  const deepLinkActive = !!designParam.trim() && !designId && !restoreId

  // Resolve the deep link before the canvas mounts, so DesignerCanvas keeps its product-first lifecycle
  // untouched (it just receives a product_id + "place this art" + "open the picker" like any other entry).
  const [resolved, setResolved] = useState<DeepLinkResolved | null>(null)
  useEffect(() => {
    if (!deepLinkActive) return
    let alive = true
    const q = new URLSearchParams({ design: designParam })
    // Resolve the garment that will actually be ON SCREEN: the link's ?garment=, else the product already in
    // the URL (post-pick navigation) — so the landing color below is computed for that garment, not the default.
    if (garmentParam) q.set('garment', garmentParam)
    else if (productIdParam) q.set('garment', productIdParam)
    fetch(`/api/deep-link?${q.toString()}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((body: DeepLinkResolved | null) => { if (alive) setResolved(body ?? { design: null, garment: null }) })
      // Resolution failed → open normally (never an error page for a deep link).
      .catch(() => { if (alive) setResolved({ design: null, garment: null }) })
    return () => { alive = false }
  }, [deepLinkActive, designParam, garmentParam, productIdParam])

  if (deepLinkActive && !resolved) return <Loading />

  // A product in the URL always wins (that's the post-pick navigation, and every pre-existing entry path);
  // the resolver's garment is only the fallback for a bare ?design= link.
  const productId = productIdParam || (deepLinkActive ? resolved?.garment?.productId ?? '' : '')
  // The picker opens on load only when nobody chose the garment: no product in the URL and no ?garment=
  // that resolved (decision 5: a resolved &garment= skips the picker — the choice was made store-side).
  const openPickerOnLoad = deepLinkActive && !productIdParam && !resolved?.garment?.matched
  // NOT gated on deepLinkActive: Next.js wires useSearchParams to the native History API, so the
  // designer's own strip of ?design= (history.replaceState after placement) re-renders this page with
  // deepLinkActive=false. The resolved design must outlive that strip — the on-load picker reads it
  // when the customer picks a garment (chooseProduct carries ?design= to the new garment). Gating it on
  // the live URL dropped the prop between placement and the pick, so the picked garment opened blank
  // (found on the branch preview, 2026-10-16). `resolved` is only ever set by a deep link, so this is
  // still undefined on every other entry path.
  const placeDecal = resolved?.design ?? undefined
  // Landing color (2026-10-17): a theme ?color= wins; else the resolver's pick — the admin's first template
  // color, or the darkest one for light artwork. Same "survives the strip" reasoning as placeDecal.
  const landingColor = initialColor || resolved?.garment?.color || ''
  
  // Safely decode title - handle any encoding issues
  let title = 'Custom Product'
  try {
    const raw = searchParams.get('title') || ''
    title = decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    title = searchParams.get('title') || 'Custom Product'
  }
  if (!searchParams.get('title') && deepLinkActive && !productIdParam && resolved?.garment?.title) title = resolved.garment.title

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
        initialColor={landingColor}
        replaceCart={replaceCart}
        replaceLine={replaceLine}
        placeDecal={placeDecal}
        openPickerOnLoad={openPickerOnLoad}
      />
    </main>
  )
}

export default function DesignerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <DesignerContent />
    </Suspense>
  )
}
