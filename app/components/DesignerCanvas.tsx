'use client'
// Module-level variable to persist active object across button clicks
let _activeObj: any = null

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import ClipartPanel from './ClipartPanel'
import { getProduct } from '../lib/shopify'
import { CustomerAuthButton } from './CustomerAuthButton'

declare global {
  interface Window {
    _printAreaData?: {
      front: { xPct: number; yPct: number; widthPct: number; heightPct: number } | null
      back:  { xPct: number; yPct: number; widthPct: number; heightPct: number } | null
    }
  }
}

interface ShopifyVariant {
  id: string
  title: string
  availableForSale: boolean
  price: { amount: string; currencyCode: string }
  selectedOptions: { name: string; value: string }[]
}

interface ShopifyProduct {
  id: string
  title: string
  options: { name: string; values: string[] }[]
  variants: { edges: { node: ShopifyVariant }[] }
  images: { edges: { node: { url: string; altText: string } }[] }
}

interface Props {
  productId: string
  variantId: string
  productTitle: string
  productPrice: number
  designId?: string
  restoreId?: string
  // Quantity carried from the product page (?quantity=). Applied to the
  // matched size so the count survives into design_orders. Optional/blank → 1.
  initialQuantity?: string
}

const COLOR_HEX_MAP: Record<string, string> = {
  'Black': '#1a1a1a',
  'White': '#f5f0e8',
  'Natural': '#e8dcc8',
  'Navy': '#1b3a6b',
  'Forest Green': '#2e5e3e',
  'Athletic Grey': '#9e9e9e',
  'Athletic Heather': '#9e9e9e',
  'Charcoal': '#4a4a4a',
  'Red': '#c0392b',
  'Royal Blue': '#1a4b9e',
  'Cardinal': '#8b0000',
  'Maroon': '#6b0000',
  'Purple': '#5b4fcf',
  'Gold': '#c9a227',
  'Orange': '#d35400',
  'Kelly Green': '#1e8449',
  'Light Pink': '#e0abe0',
  'Light Blue': '#7ac7ee',
  'Columbia Blue': '#2283de',
  'Silver': '#c0c0c0'
}

const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']

function buildColorImageMap(images: { url: string; altText: string }[]) {
  const map: Record<string, { front: string; back: string }> = {}
  images.forEach(({ url }) => {
    const filename = url.split('/').pop()?.split('?')[0] || ''
    const isFront = filename.toLowerCase().includes('_front')
    const isBack = filename.toLowerCase().includes('_back')
    if (!isFront && !isBack) return
    // Strip UUID suffix (e.g. _7eb4268e-9c21-44ad-961d-59d47598c18b) before parsing
    const cleanFilename = filename.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
    const withoutExt = cleanFilename.replace(/\.[^.]+$/, '')
    const parts = withoutExt.split('_')
    const sizePrefixes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', 'OS', 'OSFA', 'ONE']
    if (sizePrefixes.includes(parts[0].toUpperCase())) parts.shift()
    // Remove Front/Back suffix
    const cleaned = parts.filter(p =>
      p.toLowerCase() !== 'front' &&
      p.toLowerCase() !== 'back'
    )
    const colorKey = cleaned.join('').toLowerCase()
    if (!map[colorKey]) map[colorKey] = { front: '', back: '' }
    if (isFront) map[colorKey].front = url
    if (isBack) map[colorKey].back = url
  })
  Object.keys(map).forEach(key => {
    if (!map[key].front && map[key].back) map[key].front = map[key].back
    if (!map[key].back && map[key].front) map[key].back = map[key].front
  })
  return map
}

function getColorImages(
  colorName: string,
  imageMap: Record<string, { front: string; back: string }>
) {
  const key = colorName.toLowerCase().replace(/\s/g, '')
  return imageMap[key] || null
}

// Constrain a Fabric object to stay within the print area bounds
function constrainObject(obj: any, bounds: { left: number; top: number; right: number; bottom: number }) {
  // Use aCoords for accurate canvas-relative bounding box
  obj.setCoords()
  const coords = obj.aCoords
  if (!coords) return

  const objLeft   = Math.min(coords.tl.x, coords.bl.x)
  const objTop    = Math.min(coords.tl.y, coords.tr.y)
  const objRight  = Math.max(coords.tr.x, coords.br.x)
  const objBottom = Math.max(coords.bl.y, coords.br.y)

  let newLeft = obj.left
  let newTop  = obj.top

  if (objLeft < bounds.left)    newLeft = obj.left + (bounds.left  - objLeft)
  if (objRight > bounds.right)  newLeft = obj.left - (objRight - bounds.right)
  if (objTop < bounds.top)      newTop  = obj.top  + (bounds.top   - objTop)
  if (objBottom > bounds.bottom) newTop = obj.top  - (objBottom - bounds.bottom)

  obj.set({ left: newLeft, top: newTop })
  obj.setCoords()
}

// Loads an image only to read its natural pixel dimensions (naturalWidth/Height
// need no CORS). Used to convert admin-captured print-area pixels into the
// percentages the overlay renders. Resolves null on error.
function getImageNaturalSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export default function DesignerCanvas({
  productId, variantId, productTitle, productPrice, designId = '', restoreId = '', initialQuantity = ''
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shirtImgRef = useRef<HTMLImageElement>(null)
  const [fabricCanvas, setFabricCanvas] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [product, setProduct] = useState<ShopifyProduct | null>(null)
  const [selectedColor, setSelectedColor] = useState<string>('')
  const [selectedVariant, setSelectedVariant] = useState<ShopifyVariant | null>(null)
  const [shirtHex, setShirtHex] = useState('#1a1a1a')
  const [colorImageMap, setColorImageMap] = useState<Record<string, { front: string; back: string }>>({})
  const [shirtView, setShirtView] = useState<'front' | 'back'>('front')
  const [hasBackImages, setHasBackImages] = useState(false)
  const [printArea, setPrintArea] = useState<{xPct:number,yPct:number,widthPct:number,heightPct:number} | null>(null)
  const [activeTab, setActiveTab] = useState<'text' | 'upload' | 'clipart' | 'style'>('text')
  const [textInput, setTextInput] = useState('')
  const [selectedFont, setSelectedFont] = useState('Arial Black')
  const [textColor, setTextColor] = useState('#ffffff')
  const [fontSize, setFontSize] = useState(36)
  const [printMethod, setPrintMethod] = useState<string>('')
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center')
  const [selectedSvgColor, setSelectedSvgColor] = useState<string>('#000000')
  const [printPricing, setPrintPricing] = useState<Record<number, number>>({1: 12, 2: 20})
  const [dbFonts, setDbFonts] = useState<{ label: string; value: string }[]>([])
  const [dbColors, setDbColors] = useState<{ label: string; hex: string }[]>([])
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUppercase, setIsUppercase] = useState(false)
  const [textShadow, setTextShadow] = useState(false)
  const [textOutline, setTextOutline] = useState(false)
  const [textDirection, setTextDirection] = useState<'horizontal' | 'vertical' | 'curve-up' | 'curve-down'>('horizontal')
  const [curveAmount, setCurveAmount] = useState(0)
  const [selectedTextPreview, setSelectedTextPreview] = useState<string>('')
  const [selectedObjectType, setSelectedObjectType] = useState<'text' | 'image' | 'svg' | null>(null)

  // Helper to constrain all objects on canvas after property changes
  const constrainAllObjects = () => {
    if (!fabricCanvas) return
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return
    const canvasRect = canvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const scaleX = canvasEl.width  / canvasRect.width
    const scaleY = canvasEl.height / canvasRect.height
    const bounds = {
      left:   (overlayRect.left   - canvasRect.left)   * scaleX,
      top:    (overlayRect.top    - canvasRect.top)    * scaleY,
      right:  (overlayRect.right  - canvasRect.left)   * scaleX,
      bottom: (overlayRect.bottom - canvasRect.top)    * scaleY,
    }
    fabricCanvas.getObjects().forEach((obj: any) => {
      constrainObject(obj, bounds)
    })
    fabricCanvas.renderAll()
  }
  const [quantities, setQuantities] = useState<Record<string, number>>(
    SIZES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {})
  )

  // Fetch fonts and colors from Supabase based on print method
  const fetchDesignerConfig = useCallback(async (method: string) => {
    if (!method) return
    const [{ data: fontData }, { data: colorData }] = await Promise.all([
      supabase
        .from('designer_fonts')
        .select('label, value')
        .eq('print_method_key', method)
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('designer_colors')
        .select('label, hex')
        .eq('print_method_key', method)
        .eq('is_active', true)
        .order('sort_order'),
    ])
    if (fontData && fontData.length > 0) {
      setDbFonts(fontData)
      setSelectedFont(fontData[0].value)
    }
    if (colorData && colorData.length > 0) {
      setDbColors(colorData)
      setTextColor(colorData.find((c: any) => c.label === 'Black')?.hex || colorData[0].hex)
    }
  }, [])

  useEffect(() => {
    if (printMethod) {
      fetchDesignerConfig(printMethod)
      // Fetch pricing for this print method
      import('../lib/supabase').then(({ supabase }) => {
        supabase
          .from('designer_pricing')
          .select('sides, price_add')
          .eq('print_method_key', printMethod)
          .eq('is_active', true)
          .then(({ data }) => {
            if (data) {
              const map: Record<number, number> = {}
              data.forEach((row: any) => { map[row.sides] = parseFloat(row.price_add) })
              setPrintPricing(map)
            }
          })
      })
    }
  }, [printMethod, fetchDesignerConfig])

  // Restore canvas when designId provided (back from order page)
  useEffect(() => {
    if (!designId) return
    // Poll until canvas is ready, then restore
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      const canvas = (window as any)._fabricCanvas
      if (!canvas) { if (attempts > 20) clearInterval(poll); return }
      clearInterval(poll)
      supabase.from('design_orders').select('canvas_json_front').eq('id', designId).single()
        .then(({ data }) => {
          if (!data?.canvas_json_front) return
          try {
            const json = JSON.parse(data.canvas_json_front)
            if (json.objects?.length > 0) {
              canvas.loadFromJSON(json).then(() => {
                canvas.discardActiveObject()
                canvas.renderAll()
              })
            }
          } catch (e) { /* ignore */ }
        })
    }, 300)
    return () => clearInterval(poll)
  }, [designId])

  const fonts = [
    { label: 'Arial Black',     value: 'Arial Black, sans-serif' },
    { label: 'Impact',          value: 'Impact, sans-serif' },
    { label: 'Georgia',         value: 'Georgia, serif' },
    { label: 'Courier New',     value: 'Courier New, monospace' },
    { label: 'Trebuchet MS',    value: 'Trebuchet MS, sans-serif' },
    { label: 'Verdana',         value: 'Verdana, sans-serif' },
    { label: 'Times New Roman', value: 'Times New Roman, serif' },
    { label: 'Palatino',        value: 'Palatino, serif' },
    { label: 'Garamond',        value: 'Garamond, serif' },
    { label: 'Bookman',         value: 'Bookman, serif' },
    { label: 'Comic Sans MS',   value: 'Comic Sans MS, cursive' },
    { label: 'Candara',         value: 'Candara, sans-serif' },
    { label: 'Geneva',          value: 'Geneva, sans-serif' },
    { label: 'Optima',          value: 'Optima, sans-serif' },
  ]

  // Update selected text object whenever any text property changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active || (active.type !== 'i-text' && active.type !== 'textbox')) return
    {
      const currentText = (active as any).text || ''
      const currentFontSize = (active as any).fontSize || fontSize
      // Normalize text - convert to lowercase first so uppercase toggle works correctly
      // Store original on the object if not already stored
      if (!(active as any)._originalText) {
        (active as any)._originalText = currentText.replace(/\n/g, ' ').trim()
      }
      const baseText = isUppercase
        ? (active as any)._originalText.toUpperCase()
        : (active as any)._originalText
      const { text: rewrapped, fontSize: newSize } = reWrapText(
        baseText, currentFontSize, selectedFont, isBold, isItalic
      )
      active.set({
        text: rewrapped,
        fontSize: newSize,
        fontFamily: selectedFont,
        fill: textColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        textAlign: textAlign,
        charSpacing: letterSpacing * 10,
        angle: textDirection === 'vertical' ? 90 : 0,
      })
      canvas.renderAll()
      // Re-constrain after property update
      const canvasEl = canvasRef.current
      const overlay = document.querySelector('[data-print-area]') as HTMLElement
      if (overlay && canvasEl) {
        const canvasRect = canvasEl.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const scaleX = canvasEl.width / canvasRect.width
        const scaleY = canvasEl.height / canvasRect.height
        const bounds = {
          left:   (overlayRect.left   - canvasRect.left) * scaleX,
          top:    (overlayRect.top    - canvasRect.top)  * scaleY,
          right:  (overlayRect.right  - canvasRect.left) * scaleX,
          bottom: (overlayRect.bottom - canvasRect.top)  * scaleY,
        }
        constrainObject(active, bounds)
        canvas.renderAll()
      }
    }
  }, [selectedFont, textColor, isBold, isItalic, isUppercase, textAlign, letterSpacing, textDirection, textOutline, curveAmount])

  // Constrain all objects whenever fontSize changes (slider update)
  const fabricCanvasRef = useRef<any>(null)
  const lastActiveObjectRef = useRef<any>(null)
  const frontObjectsRef = useRef<any[]>([])
  const backObjectsRef = useRef<any[]>([])
  const uploadedFilesRef = useRef<{ name: string; url: string; type: string }[]>([])
  // Which template / print areas the current session resolved — stamped onto
  // the design_orders row at save time (Day 3 backend-completeness). The *Snap
  // refs hold the full area rows so print geometry survives later admin edits.
  const templateIdRef = useRef<string | null>(null)
  const printAreaFrontIdRef = useRef<string | null>(null)
  const printAreaBackIdRef = useRef<string | null>(null)
  const printAreaFrontSnapRef = useRef<any>(null)
  const printAreaBackSnapRef = useRef<any>(null)
  useEffect(() => {
    fabricCanvasRef.current = fabricCanvas
  }, [fabricCanvas])

  // Restore a design snapshotted before a Shopify login round-trip. Runs once,
  // only after BOTH the fabric canvas and the product have loaded (so the draft
  // values win over the color/quantity defaults the product fetch sets), then
  // strips ?restore= from the URL so a refresh doesn't re-restore.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!restoreId || restoredRef.current) return
    if (!fabricCanvas || !product) return
    restoredRef.current = true

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('restore')
        window.history.replaceState({}, '', url.pathname + url.search)
      } catch { /* ignore */ }
    }

    ;(async () => {
      try {
        const res = await fetch(`/api/designs/draft?id=${restoreId}`, { cache: 'no-store' })
        if (!res.ok) return
        const { state } = await res.json()
        if (!state) return

        const canvas = fabricCanvas
        const { util } = await import('fabric')

        // Front objects become the live canvas; back objects live in the ref so
        // the Back toggle rehydrates them. We restore into the front view.
        if (state.front) {
          await canvas.loadFromJSON(state.front)
        }
        if (state.back?.objects?.length) {
          backObjectsRef.current = (await util.enlivenObjects(state.back.objects)) as any[]
        } else {
          backObjectsRef.current = []
        }
        frontObjectsRef.current = []
        canvas.discardActiveObject()
        canvas.renderAll()

        // Re-apply shirt color (image + hex + variant) without the quantity
        // reset that handleColorSelect does, then restore quantities directly.
        if (state.selectedColor) {
          setSelectedColor(state.selectedColor)
          setShirtHex(COLOR_HEX_MAP[state.selectedColor] || '#888')
          const imgs = getColorImages(state.selectedColor, colorImageMap)
          if (imgs?.front && shirtImgRef.current) shirtImgRef.current.src = imgs.front
          const match = product.variants.edges.find(({ node }) =>
            node.selectedOptions.some(o => o.name === 'Color' && o.value === state.selectedColor)
          )
          if (match) setSelectedVariant(match.node)
        }
        if (state.printMethod) setPrintMethod(state.printMethod)
        if (state.quantities) setQuantities(state.quantities)
        if (Array.isArray(state.uploadedFiles)) uploadedFilesRef.current = state.uploadedFiles
        setShirtView('front')
      } catch (err) {
        console.error('[designer] restore failed:', err)
      } finally {
        cleanUrl()
      }
    })()
  }, [restoreId, fabricCanvas, product, colorImageMap])

  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    // Update active object - re-wrap text at new font size
    const active = canvas.getActiveObject()
    if (active && (active.type === 'i-text' || active.type === 'textbox')) {
      const currentText = (active as any).text || ''
      const { text: rewrapped, fontSize: newSize } = reWrapText(
        currentText, fontSize, selectedFont, isBold, isItalic
      )
      active.set({
        text: rewrapped,
        fontSize: newSize,
        fontFamily: selectedFont,
        fill: textColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        textAlign: textAlign,
        charSpacing: letterSpacing * 10,
        scaleX: 1,
        scaleY: 1,
      })
      canvas.renderAll()
    }
    setTimeout(() => {
      const canvasEl = canvasRef.current
      const overlay = document.querySelector('[data-print-area]') as HTMLElement
      if (!overlay || !canvasEl) return
      const canvasRect = canvasEl.getBoundingClientRect()
      const overlayRect = overlay.getBoundingClientRect()
      const scaleX = canvasEl.width  / canvasRect.width
      const scaleY = canvasEl.height / canvasRect.height
      const bounds = {
        left:   (overlayRect.left   - canvasRect.left)   * scaleX,
        top:    (overlayRect.top    - canvasRect.top)    * scaleY,
        right:  (overlayRect.right  - canvasRect.left)   * scaleX,
        bottom: (overlayRect.bottom - canvasRect.top)    * scaleY,
      }
      canvas.getObjects().forEach((obj: any) => {
        constrainObject(obj, bounds)
      })
      canvas.renderAll()
    }, 50)
  }, [fontSize])

  useEffect(() => {
    if (!productId) return
    fetch(`/api/product?id=${productId}`)
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setProduct(data)
          const allImages = data.images?.edges?.map(
            ({ node }: any) => ({ url: node.url, altText: node.altText })
          ) || []
          const imgMap = buildColorImageMap(allImages)
          setColorImageMap(imgMap)
          // Check raw image URLs for actual _back files
          const anyBack = allImages.some(({ url }: { url: string }) =>
            url.split('/').pop()?.toLowerCase().includes('_back')
          )
          setHasBackImages(anyBack)
          // Parse print method
          // Set print method from metafield or default to screen_print
          const method = data.printMethod?.value || 'screen_print'
          setPrintMethod(method)
          // Directly fetch fonts and colors for this method
          ;(async () => {
          const [{ data: fontData }, { data: colorData }] = await Promise.all([
            supabase.from('designer_fonts').select('label, value')
              .eq('print_method_key', method).eq('is_active', true).order('sort_order'),
            supabase.from('designer_colors').select('label, hex')
              .eq('print_method_key', method).eq('is_active', true).order('sort_order'),
          ])
          if (fontData && fontData.length > 0) {
            setDbFonts(fontData)
            setSelectedFont(fontData[0].value)
          }
          if (colorData && colorData.length > 0) {
            setDbColors(colorData)
            setTextColor(colorData.find((c: any) => c.label === 'Black')?.hex || colorData[0].hex)
          }
          })()

          // Print area: prefer admin-managed product_templates; fall back to the
          // legacy Shopify metafield for products without a template row.
          ;(async () => {
            try {
              const { supabase } = await import('../lib/supabase')
              const { data: tpl } = await supabase
                .from('product_templates')
                .select('id, default_print_method, product_template_print_areas(*)')
                .eq('shopify_product_id', data.id)
                .eq('is_active', true)
                .maybeSingle()

              const areas = (tpl?.product_template_print_areas || []) as any[]
              if (tpl && areas.length > 0) {
                // Print-area px are stored in the mockup's NATURAL pixel space.
                // Convert to the percentages the overlay renders, deriving the
                // reference natural size from a loaded product image (all color
                // mockups share aspect). See CLAUDE.md "pixels vs. percentages".
                const refUrl = allImages[0]?.url
                const natural = refUrl ? await getImageNaturalSize(refUrl) : null
                if (natural) {
                  const forMethod = areas.filter(a => a.print_method === method)
                  // Single area per side for Phase 3: the first by sort_order.
                  const pickSide = (side: string) =>
                    forMethod.filter(a => a.side === side)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] || null
                  // Containment-aware px -> %. The area px are relative to the
                  // mockup's natural box (natural.w x natural.h), but the shirt
                  // image is rendered with objectFit: contain inside a fixed
                  // CONTAINER_W x CONTAINER_H box. When the image aspect differs
                  // from the container aspect, `contain` letterboxes (fills width,
                  // bars top/bottom) or pillarboxes (fills height, bars L/R) the
                  // image — so we must place the area inside the image's *rendered*
                  // box (scaled + offset), then express that as a % of the
                  // container. Ignoring this stretched the box on the boxed axis
                  // and shifted it by the missing offset.
                  const CONTAINER_W = 680, CONTAINER_H = 850
                  const containerAspect = CONTAINER_W / CONTAINER_H
                  const imageAspect = natural.w / natural.h
                  const toPct = (a: any) => {
                    if (!a) return null
                    const fx = a.x_px / natural.w
                    const fy = a.y_px / natural.h
                    const fw = a.width_px / natural.w
                    const fh = a.height_px / natural.h
                    let xFrac: number, yFrac: number, wFrac: number, hFrac: number
                    if (imageAspect >= containerAspect) {
                      // Fills container width; letterboxed top/bottom.
                      const rhFrac = containerAspect / imageAspect  // rendered height / container height
                      const offY = (1 - rhFrac) / 2
                      xFrac = fx;  wFrac = fw
                      yFrac = offY + fy * rhFrac
                      hFrac = fh * rhFrac
                    } else {
                      // Fills container height; pillarboxed left/right.
                      const rwFrac = imageAspect / containerAspect  // rendered width / container width
                      const offX = (1 - rwFrac) / 2
                      yFrac = fy;  hFrac = fh
                      xFrac = offX + fx * rwFrac
                      wFrac = fw * rwFrac
                    }
                    return {
                      xPct: xFrac * 100,
                      yPct: yFrac * 100,
                      widthPct: wFrac * 100,
                      heightPct: hFrac * 100,
                    }
                  }
                  const frontArea = pickSide('front')
                  const backArea = pickSide('back')
                  const pa = { front: toPct(frontArea), back: toPct(backArea) }
                  if (pa.front || pa.back) {
                    window._printAreaData = pa
                    setPrintArea(pa.front || pa.back)
                    templateIdRef.current = tpl.id
                    printAreaFrontIdRef.current = frontArea?.id ?? null
                    printAreaBackIdRef.current = backArea?.id ?? null
                    printAreaFrontSnapRef.current = frontArea ?? null
                    printAreaBackSnapRef.current = backArea ?? null
                    return
                  }
                }
              }
            } catch (e) {
              console.error('Template print-area read failed, falling back to metafield:', e)
            }
            // Fallback: legacy Shopify metafield (already stored as percentages).
            if (data.printArea?.value) {
              try {
                const pa = JSON.parse(data.printArea.value)
                setPrintArea(pa.front)
                window._printAreaData = pa
              } catch (e) { console.error('Print area parse error', e) }
            } else if (data.metafield?.value) {
              try {
                const pa = JSON.parse(data.metafield.value)
                setPrintArea(pa.front)
                window._printAreaData = pa
              } catch (e) { console.error('Print area parse error', e) }
            }
          })()
          const colorOption = data.options?.find((o: any) => o.name === 'Color')
          if (colorOption?.values?.length > 0) {
            const firstColor = colorOption.values[0]

            // Match the URL's variant_id (bare numeric) against the variant GID
            // by EXACT id, not substring. String.includes('') is always true, so
            // an empty/missing variantId used to silently match the FIRST variant
            // (e.g. gold/L landing on Columbia Blue/S). Guard on a non-empty
            // variantId and compare the trailing numeric of the GID exactly.
            const matchedVariant = variantId
              ? data.variants?.edges?.find(
                  (e: any) => e.node.id.split('/').pop() === variantId
                )?.node
              : undefined
            const matchedColor = matchedVariant?.selectedOptions.find(
              (o: any) => o.name === 'Color'
            )?.value
            const matchedSize = matchedVariant?.selectedOptions.find(
              (o: any) => o.name === 'Size'
            )?.value

            // Resolve the color to actually use, then drive EVERY downstream
            // piece of state from it. Previously hex, the shirt image, and
            // selectedVariant were hardcoded to firstColor even when a different
            // variant matched — so the picker could say "Gold" while the shirt,
            // price, and saved variant were all the first color.
            const resolvedColor = matchedColor || firstColor
            setSelectedColor(resolvedColor)
            setShirtHex(COLOR_HEX_MAP[resolvedColor] || '#888')
            const imgs = getColorImages(resolvedColor, imgMap)
            if (imgs?.front && shirtImgRef.current) shirtImgRef.current.src = imgs.front

            // Pre-select the matched size with the quantity carried from the
            // product page (?quantity=), defaulting to 1.
            if (matchedSize) {
              const qty = Math.max(1, parseInt(initialQuantity || '', 10) || 1)
              setQuantities((prev: Record<string, number>) => ({ ...prev, [matchedSize]: qty }))
            }

            // selectedVariant must reflect the resolved color — it's saved as
            // shopify_variant_id and drives unit price + cart-add (a wrong/empty
            // one is the "Cannot find variant" cart error). Prefer the exact
            // matched variant, else the first variant of the resolved color.
            const chosenVariant = matchedVariant
              || data.variants?.edges?.find(({ node }: any) =>
                   node.selectedOptions.some(
                     (o: any) => o.name === 'Color' && o.value === resolvedColor
                   )
                 )?.node
            if (chosenVariant) setSelectedVariant(chosenVariant)
          }
        }
      })
      .catch(err => console.error('Failed to fetch product:', err))
  }, [productId])

  useEffect(() => {
    let canvas: any = null
    const initFabric = async () => {
      const { Canvas } = await import('fabric')
      if (!canvasRef.current) return
      canvas = new Canvas(canvasRef.current ?? undefined, {
        width: 680,
        height: 850,
        backgroundColor: 'transparent',
        preserveObjectStacking: true,
      })
      const getLiveBounds = () => {
        const canvasEl = canvasRef.current
        if (!canvasEl) return null
        const overlay = document.querySelector('[data-print-area]') as HTMLElement
        if (!overlay) return null
        const canvasRect = canvasEl.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const scaleX = canvasEl.width  / canvasRect.width
        const scaleY = canvasEl.height / canvasRect.height
        return {
          left:   (overlayRect.left   - canvasRect.left)   * scaleX,
          top:    (overlayRect.top    - canvasRect.top)    * scaleY,
          right:  (overlayRect.right  - canvasRect.left)   * scaleX,
          bottom: (overlayRect.bottom - canvasRect.top)    * scaleY,
        }
      }

      canvas.on('object:moving', (e: any) => {
        const obj = e.target
        if (!obj) return
        const bounds = getLiveBounds()
        if (!bounds) return
        constrainObject(obj, bounds)
      })

      canvas.on('object:scaling', (e: any) => {
        const obj = e.target
        if (!obj) return
        const bounds = getLiveBounds()
        if (!bounds) return

        const boundsW = bounds.right  - bounds.left
        const boundsH = bounds.bottom - bounds.top

        // Clamp scale so object never exceeds print area dimensions
        const maxScaleX = boundsW / (obj.width  || 1)
        const maxScaleY = boundsH / (obj.height || 1)
        const maxScale  = Math.min(maxScaleX, maxScaleY)

        if (obj.scaleX > maxScale) obj.set({ scaleX: maxScale })
        if (obj.scaleY > maxScale) obj.set({ scaleY: maxScale })

        // Then constrain position
        constrainObject(obj, bounds)
      })

      // Track selected object text for font preview
      canvas.on('selection:created', (e: any) => {
        const obj = e.selected?.[0]
        if (obj) { lastActiveObjectRef.current = obj; _activeObj = obj }
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
          const raw = (obj as any)._originalText || obj.text || ''
          setSelectedTextPreview(raw.replace(/\n/g, ' ').trim())
          setSelectedObjectType('text')
        } else if (obj) {
          setSelectedObjectType((obj as any)._isSvg ? 'svg' : 'image')
          if ((obj as any)._isSvg && (obj as any)._currentColor) {
            setSelectedSvgColor((obj as any)._currentColor)
          } else if ((obj as any)._isSvg) {
            setSelectedSvgColor('')
          }
          setSelectedTextPreview('')
        }
      })
      canvas.on('selection:updated', (e: any) => {
        const obj = e.selected?.[0]
        if (obj) { lastActiveObjectRef.current = obj; _activeObj = obj }
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox')) {
          const raw = (obj as any)._originalText || obj.text || ''
          setSelectedTextPreview(raw.replace(/\n/g, ' ').trim())
          setSelectedObjectType('text')
        } else if (obj) {
          setSelectedObjectType((obj as any)._isSvg ? 'svg' : 'image')
          if ((obj as any)._isSvg && (obj as any)._currentColor) {
            setSelectedSvgColor((obj as any)._currentColor)
          } else if ((obj as any)._isSvg) {
            setSelectedSvgColor('')
          }
          setSelectedTextPreview('')
        } else {
          setSelectedTextPreview('')
          setSelectedObjectType(null)
        }
      })
      canvas.on('selection:cleared', () => {
        setSelectedTextPreview('')
        setSelectedObjectType(null)
      })

      setFabricCanvas(canvas)
      ;(window as any)._fabricCanvas = canvas

      // Restore saved design if returning from order page
      if (designId) {
        setTimeout(() => {
          import('../lib/supabase').then(({ supabase }) => {
            supabase.from('design_orders').select('canvas_json_front').eq('id', designId).single()
              .then(({ data }) => {
                if (!data?.canvas_json_front) return
                try {
                  const json = JSON.parse(data.canvas_json_front)
                  if (json.objects?.length > 0) {
                    canvas.loadFromJSON(json).then(() => {
                      canvas.discardActiveObject()
                      canvas.renderAll()
                    })
                  }
                } catch (e) { /* ignore restore errors */ }
              })
          })
        }, 1200)
      }

      // Custom selection handles
      import('fabric').then(({ controlsUtils, Control, util }) => {
        // Helper to render icon controls
        const renderIcon = (icon: string) => (ctx: CanvasRenderingContext2D, left: number, top: number, _: any, fabricObject: any) => {
          const size = 20
          ctx.save()
          ctx.translate(left, top)
          ctx.rotate(util.degreesToRadians(fabricObject.angle || 0))
          ctx.fillStyle = '#dd3333'
          ctx.beginPath()
          ctx.arc(0, 0, size / 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.font = `bold ${size * 0.55}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(icon, 0, 1)
          ctx.restore()
        }

        // Rotate control (center-top)
        const rotateControl = new Control({
          x: 0, y: -0.5,
          offsetX: 0, offsetY: -20,
          cursorStyle: 'crosshair',
          actionHandler: controlsUtils.rotationWithSnapping,
          actionName: 'rotate',
          render: renderIcon('↻'),
          sizeX: 26, sizeY: 26,
          withConnection: false,
        })

        // Delete control (bottom-right) - moved from top-right
        const deleteControl = new Control({
          x: 0.5, y: 0.5,
          offsetX: 10, offsetY: 10,
          cursorStyle: 'pointer',
          mouseUpHandler: (_: any, transform: any) => {
            const target = transform.target
            canvas.remove(target)
            canvas.requestRenderAll?.() || canvas.renderAll()
            return true
          },
          render: renderIcon('✕'),
          sizeX: 26, sizeY: 26,
        })

        // Scale equally (top-right) - moved from top-right delete
        const scaleControl = new Control({
          x: 0.5, y: -0.5,
          offsetX: 10, offsetY: -10,
          cursorStyle: 'ne-resize',
          actionHandler: controlsUtils.scalingEqually,
          actionName: 'scale',
          render: renderIcon('⤢'),
          sizeX: 26, sizeY: 26,
        })

        // Scale bottom-left
        const scaleBLControl = new Control({
          x: -0.5, y: 0.5,
          offsetX: -10, offsetY: 10,
          cursorStyle: 'sw-resize',
          actionHandler: controlsUtils.scalingEqually,
          actionName: 'scale',
          render: renderIcon('⤡'),
          sizeX: 26, sizeY: 26,
        })

        // Stretch-X control (middle-right)
        const stretchControl = new Control({
          x: 0.5, y: 0,
          offsetX: 10, offsetY: 0,
          cursorStyle: 'ew-resize',
          actionHandler: controlsUtils.scalingXOrSkewingY,
          actionName: 'scaleX',
          render: renderIcon('↔'),
          sizeX: 26, sizeY: 26,
        })

        const applyControls = (obj: any) => {
          obj.controls = {
            rotateControl,
            deleteControl,
            scaleControl,
            scaleBLControl,
            stretchControl,
            // Top-left scale
            tl: new Control({
              x: -0.5, y: -0.5,
              offsetX: -10, offsetY: -10,
              cursorStyle: 'nw-resize',
              actionHandler: controlsUtils.scalingEqually,
              render: renderIcon('⤢'),
              sizeX: 26, sizeY: 26,
            }),
          }
          obj.setCoords()
        }

        canvas.on('object:added', (e: any) => {
          if (e.target) applyControls(e.target)
        })
        canvas.on('selection:created', (e: any) => {
          if (e.selected) e.selected.forEach(applyControls)
        })
        // Apply to existing objects
        canvas.getObjects().forEach(applyControls)
        canvas.renderAll()
      })
      ;(window as any)._alignObject = (fn: string) => {
        const active = canvas.getActiveObject() || _activeObj || lastActiveObjectRef.current || canvas.getObjects()[canvas.getObjects().length - 1]
        if (!active) return
        const canvasEl = canvasRef.current
        const overlay = document.querySelector('[data-print-area]') as HTMLElement
        if (!overlay || !canvasEl) return
        const cr = canvasEl.getBoundingClientRect()
        const or = overlay.getBoundingClientRect()
        const sx = canvasEl.width / cr.width
        const sy = canvasEl.height / cr.height
        const oL = (or.left - cr.left) * sx
        const oR = (or.right - cr.left) * sx
        const oT = (or.top - cr.top) * sy
        const oB = (or.bottom - cr.top) * sy
        const w = active.getScaledWidth()
        const h = active.getScaledHeight()
        if (fn === 'left')   active.set({ left: oL + w / 2, originX: 'center' })
        if (fn === 'center') active.set({ left: (oL + oR) / 2, originX: 'center' })
        if (fn === 'right')  active.set({ left: oR - w / 2, originX: 'center' })
        if (fn === 'top')    active.set({ top: oT + h / 2, originY: 'center' })
        if (fn === 'middle') active.set({ top: (oT + oB) / 2, originY: 'center' })
        if (fn === 'bottom') active.set({ top: oB - h / 2, originY: 'center' })
        active.setCoords()
        canvas.renderAll()
      }
      setIsLoading(false)
    }
    initFabric()
    return () => { if (canvas) canvas.dispose() }
  }, [])

  const handleColorSelect = useCallback((color: string) => {
    setSelectedColor(color)
    setShirtHex(COLOR_HEX_MAP[color] || '#888')
    setQuantities(SIZES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {}))
    const imgs = getColorImages(color, colorImageMap)
    if (imgs) {
      const url = shirtView === 'back'
        ? (imgs.back || imgs.front)
        : (imgs.front || imgs.back)
      if (url && shirtImgRef.current) shirtImgRef.current.src = url
    }
    if (product) {
      const match = product.variants.edges.find(({ node }) =>
        node.selectedOptions.some(o => o.name === 'Color' && o.value === color)
      )
      if (match) setSelectedVariant(match.node)
    }
  }, [product, colorImageMap, shirtView])

  const isSizeAvailable = useCallback((size: string) => {
    if (!product || !selectedColor) return false
    return product.variants.edges.some(({ node }) =>
      node.availableForSale &&
      node.selectedOptions.some(o => o.name === 'Color' && o.value === selectedColor) &&
      node.selectedOptions.some(o => o.name === 'Size' && o.value === size)
    )
  }, [product, selectedColor])

  const colors = product?.options.find(o => o.name === 'Color')?.values || []

  // Re-wrap text to fit print area at given font size
  // Re-render curved text when curveAmount changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return

    // Get original text
    const rawText = (active as any)._originalText || (active as any).text || ''
    if (!rawText) return

    const spawnX = (active as any).left || 280
    const spawnY = (active as any).top || 350

    if (curveAmount === 0) {
      // Switch back to normal IText
      if ((active as any)._isCurvedText) {
        canvas.remove(active)
        import('fabric').then(({ IText }) => {
          const { text: wrappedText, fontSize: autoFontSize } = reWrapText(rawText, fontSize, selectedFont, isBold, isItalic)
          const textObj = new IText(wrappedText, {
            left: spawnX, top: spawnY,
            fontFamily: selectedFont, fontSize: autoFontSize,
            fill: textColor, fontWeight: isBold ? 'bold' : 'normal',
            fontStyle: isItalic ? 'italic' : 'normal',
            textAlign: textAlign, charSpacing: letterSpacing * 10,
            originX: 'center', originY: 'center',
          })
          ;(textObj as any)._originalText = rawText
          canvas.add(textObj)
          canvas.setActiveObject(textObj)
          lastActiveObjectRef.current = textObj
          canvas.renderAll()
        })
      }
      return
    }

    // Render curved version
    const direction = curveAmount > 0 ? 'curve-up' : 'curve-down'
    const absAmount = Math.abs(curveAmount)
    const fSize = fontSize
    // Radius: large = gentle curve, small = tight curve
    // At absAmount=1: very gentle, at absAmount=100: very tight
    const radius = Math.max(fSize * 1.5, 800 - absAmount * 7.5)

    const tmpCanvas = document.createElement('canvas')
    const tmpCtx = tmpCanvas.getContext('2d')!
    tmpCtx.font = `${isItalic ? 'italic' : 'normal'} ${isBold ? 'bold' : 'normal'} ${fSize}px ${selectedFont}`
    const chars = rawText.split('')
    const charWidths = chars.map((ch: string) => tmpCtx.measureText(ch).width)
    const totalWidth = charWidths.reduce((a: number, b: number) => a + b, 0)
    // Canvas size based on text width + radius, but capped sensibly
    const padding = fSize * 2
    const size = Math.min(Math.max(totalWidth + padding * 2, radius * 2 + padding * 2), 1200)
    const offCanvas = document.createElement('canvas')
    offCanvas.width = size
    offCanvas.height = size
    const ctx = offCanvas.getContext('2d')!
    ctx.font = `${isItalic ? 'italic' : 'normal'} ${isBold ? 'bold' : 'normal'} ${fSize}px ${selectedFont}`
    ctx.fillStyle = textColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const totalAngle = totalWidth / radius
    const isDown = direction === 'curve-down'
    const orderedChars = isDown ? [...chars].reverse() : chars
    const orderedWidths = isDown ? [...charWidths].reverse() : charWidths
    let currentAngle = -totalAngle / 2
    // Position center so arc appears in top portion for curve-up, bottom for curve-down
    const cx = size / 2
    const cy = direction === 'curve-up' ? size * 0.72 : size * 0.28

    orderedChars.forEach((ch: string, idx: number) => {
      const charAngle = currentAngle + orderedWidths[idx] / radius / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(charAngle)
      ctx.translate(0, direction === 'curve-up' ? -radius : radius)

      ctx.fillText(ch, 0, 0)
      ctx.restore()
      currentAngle += orderedWidths[idx] / radius
    })

    canvas.remove(active)
    import('fabric').then(({ FabricImage }) => {
      // Crop to actual text pixels
      const cropCanvas = document.createElement('canvas')
      const cropCtx = cropCanvas.getContext('2d')!
      const imgData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height)
      const pixels = imgData.data
      let minX = offCanvas.width, minY = offCanvas.height, maxX = 0, maxY = 0
      for (let y = 0; y < offCanvas.height; y++) {
        for (let x = 0; x < offCanvas.width; x++) {
          if (pixels[(y * offCanvas.width + x) * 4 + 3] > 10) {
            minX = Math.min(minX, x); minY = Math.min(minY, y)
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
          }
        }
      }
      const pad = Math.ceil(fSize * 0.3)
      minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
      maxX = Math.min(offCanvas.width - 1, maxX + pad)
      maxY = Math.min(offCanvas.height - 1, maxY + pad)
      cropCanvas.width = Math.max(1, maxX - minX)
      cropCanvas.height = Math.max(1, maxY - minY)
      cropCtx.drawImage(offCanvas, minX, minY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height)
      const dataUrl = cropCanvas.toDataURL('image/png')
      FabricImage.fromURL(dataUrl).then((img: any) => {
        img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
        ;(img as any)._isCurvedText = true
        ;(img as any)._originalText = rawText
        canvas.add(img)
        canvas.setActiveObject(img)
        lastActiveObjectRef.current = img
        _activeObj = img
        canvas.renderAll()
      })
    })
  }, [curveAmount, fontSize, selectedFont, textColor, isBold, isItalic])

  const reWrapText = (text: string, targetFontSize: number, fontFamily: string, bold: boolean, italic: boolean): { text: string; fontSize: number } => {
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return { text, fontSize: targetFontSize }

    const canvasRect = canvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const scaleX = canvasEl.width / canvasRect.width
    const maxWidth = overlayRect.width * scaleX * 0.92
    const maxHeight = overlayRect.height * (canvasEl.height / canvasRect.height) * 0.92

    const tmpCanvas = document.createElement('canvas')
    const tmpCtx = tmpCanvas.getContext('2d')!
    const fontWeight = bold ? 'bold' : 'normal'
    const fontStyle = italic ? 'italic' : 'normal'

    const measureWidth = (t: string, size: number) => {
      tmpCtx.font = `${fontStyle} ${fontWeight} ${size}px ${fontFamily}`
      return tmpCtx.measureText(t).width
    }

    // Use original text without existing newlines for re-wrapping
    const cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    const words = cleanText.split(' ')
    let autoFontSize = targetFontSize

    // Reduce font size until longest word fits
    while (autoFontSize > 8) {
      const longestWord = words.reduce((a, b) =>
        measureWidth(a, autoFontSize) > measureWidth(b, autoFontSize) ? a : b
      )
      if (measureWidth(longestWord, autoFontSize) <= maxWidth) break
      autoFontSize -= 1
    }

    // Build wrapped lines
    const buildLines = (size: number) => {
      const lines: string[] = []
      let currentLine = ''
      words.forEach(word => {
        const testLine = currentLine ? currentLine + ' ' + word : word
        if (measureWidth(testLine, size) > maxWidth && currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = testLine
        }
      })
      if (currentLine) lines.push(currentLine)
      return lines
    }

    // Reduce font size until all lines fit vertically
    let lines = buildLines(autoFontSize)
    while (autoFontSize > 8 && lines.length * autoFontSize * 1.2 > maxHeight) {
      autoFontSize -= 1
      lines = buildLines(autoFontSize)
    }

    return { text: lines.join('\n'), fontSize: autoFontSize }
  }

  // Recolor selected SVG clipart
  const recolorSvg = (hex: string) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const obj = canvas.getActiveObject() as any
    if (!obj || !obj._isSvg) return
    obj._currentColor = hex
    // For FabricImage SVGs, we tint using filters
    import('fabric').then(({ filters }) => {
      obj.filters = [new filters.BlendColor({ color: hex, mode: 'tint', alpha: 1 })]
      obj.applyFilters()
      canvas.renderAll()
    })
  }

  // Create curved text by rendering to a canvas then adding as Fabric image
  const createCurvedText = (canvas: any, text: string, direction: 'curve-up' | 'curve-down', spawnX: number, spawnY: number) => {
    const fSize = fontSize
    const fontFamily = selectedFont
    const fill = textColor
    const fontWeight = isBold ? 'bold' : 'normal'
    const fontStyle = isItalic ? 'italic' : 'normal'
    const radius = Math.max(fSize * 1.5, 600)
    const padding = fSize * 2

    // Create an offscreen canvas to draw curved text
    const offCanvas = document.createElement('canvas')
    // Measure text first using a temp canvas to get totalWidth
    const tempCtx = document.createElement('canvas').getContext('2d')!
    tempCtx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`
    const chars = text.split('')
    const charWidths = chars.map((ch: string) => tempCtx.measureText(ch).width + (letterSpacing || 0))
    const totalWidth = charWidths.reduce((a: number, b: number) => a + b, 0)
    const totalAngle = totalWidth / radius
    const size = Math.min(Math.max(totalWidth + padding * 2, (radius + padding) * 2), 1200)
    offCanvas.width = size
    offCanvas.height = size
    const ctx = offCanvas.getContext('2d')!

    ctx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily}`
    ctx.fillStyle = fill
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'


    // Center of the offscreen canvas
    const cx = size / 2
    const cy = direction === 'curve-up' ? size * 0.72 : size * 0.28

    const isDown = direction === 'curve-down'
    const orderedChars = isDown ? [...chars].reverse() : chars
    const orderedWidths = isDown ? [...charWidths].reverse() : charWidths
    let currentAngle = -totalAngle / 2

    orderedChars.forEach((ch, idx) => {
      const charAngle = currentAngle + orderedWidths[idx] / radius / 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(charAngle)
      ctx.translate(0, direction === 'curve-up' ? -radius : radius)

      ctx.fillText(ch, 0, 0)
      ctx.restore()
      currentAngle += orderedWidths[idx] / radius
    })

    // Convert canvas to image and add to Fabric
    import('fabric').then(({ FabricImage }) => {
      // Crop offscreen canvas to actual text bounds
      const cropCanvas = document.createElement('canvas')
      const cropCtx = cropCanvas.getContext('2d')!
      const imgData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height)
      const pixels = imgData.data
      let minX = offCanvas.width, minY = offCanvas.height, maxX = 0, maxY = 0
      for (let y = 0; y < offCanvas.height; y++) {
        for (let x = 0; x < offCanvas.width; x++) {
          const alpha = pixels[(y * offCanvas.width + x) * 4 + 3]
          if (alpha > 10) {
            minX = Math.min(minX, x); minY = Math.min(minY, y)
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
          }
        }
      }
      const pad = fSize * 0.3
      minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
      maxX = Math.min(offCanvas.width, maxX + pad); maxY = Math.min(offCanvas.height, maxY + pad)
      cropCanvas.width = Math.max(1, maxX - minX)
      cropCanvas.height = Math.max(1, maxY - minY)
      cropCtx.drawImage(offCanvas, minX, minY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height)
      const dataUrl = cropCanvas.toDataURL('image/png')
      FabricImage.fromURL(dataUrl).then((img: any) => {
        const fabricCanvasEl = canvasRef.current
        const overlay = document.querySelector('[data-print-area]') as HTMLElement
        if (overlay && fabricCanvasEl) {
          const canvasRect = fabricCanvasEl.getBoundingClientRect()
          const overlayRect = overlay.getBoundingClientRect()
          const scaleX = fabricCanvasEl.width / canvasRect.width
          const maxW = overlayRect.width * scaleX * 0.9
          if (img.width > maxW) img.scaleToWidth(maxW)
        }
        img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
        ;(img as any)._isCurvedText = true
        ;(img as any)._originalText = text
        canvas.add(img)
        canvas.setActiveObject(img)
        lastActiveObjectRef.current = img
        canvas.renderAll()
      })
    })
  }


  const addText = () => {
    if (!fabricCanvas || !textInput.trim()) return
    import('fabric').then(({ IText }) => {
      const canvasEl = canvasRef.current
      const overlay = document.querySelector('[data-print-area]') as HTMLElement
      let spawnX = 280
      let spawnY = 378
      if (overlay && canvasEl) {
        const canvasRect = canvasEl.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const scaleX = canvasEl.width / canvasRect.width
        const scaleY = canvasEl.height / canvasRect.height
        const paLeft  = (overlayRect.left - canvasRect.left) * scaleX
        const paTop   = (overlayRect.top  - canvasRect.top)  * scaleY
        const paWidth  = overlayRect.width  * scaleX
        const paHeight = overlayRect.height * scaleY
        spawnX = paLeft + paWidth  / 2
        spawnY = paTop  + paHeight / 2
      }
      const rawText = isUppercase ? textInput.toUpperCase() : textInput

      // Handle curved text separately
      if (textDirection === 'curve-up' || textDirection === 'curve-down') {
        createCurvedText(fabricCanvas, rawText, textDirection, spawnX, spawnY)
        setTextInput('')
        return
      }

      const { text: wrappedText, fontSize: autoFontSize } = reWrapText(rawText, fontSize, selectedFont, isBold, isItalic)

      const textObj = new IText(wrappedText, {
        left: spawnX,
        top: spawnY,
        fontFamily: selectedFont,
        fontSize: autoFontSize,
        fill: textColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        textAlign: textAlign,
        charSpacing: letterSpacing * 10,
        angle: textDirection === 'vertical' ? 90 : 0,
        originX: 'center',
        originY: 'center',
      })
      // Store original text for uppercase toggle
      ;(textObj as any)._originalText = textInput.trim()
      fabricCanvas.add(textObj)
      fabricCanvas.setActiveObject(textObj)
      lastActiveObjectRef.current = textObj
      _activeObj = textObj
      fabricCanvas.renderAll()
      setTextInput('')
    })
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !fabricCanvas) return

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const cloudinaryFormats = ['ai', 'psd', 'eps']

    // AI, PSD, EPS — upload to Cloudinary which converts them to PNG
    if (cloudinaryFormats.includes(ext)) {
      try {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
        const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
        const fd = new FormData()
        fd.append('file', file)
        fd.append('upload_preset', uploadPreset!)
        // AI/EPS use 'image' resource type, PSD also image
        // Request PNG delivery format via URL transformation
        const resourceType = ext === 'psd' ? 'image' : 'image'
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          const errData = await res.json()
          throw new Error(`Cloudinary: ${errData.error?.message || res.statusText}`)
        }
        const data = await res.json()
        // Use Cloudinary URL transformation to get PNG version
        const pngUrl = data.secure_url.replace('/upload/', '/upload/f_png/')
        const { FabricImage } = await import('fabric')
        const img = await FabricImage.fromURL(pngUrl, { crossOrigin: 'anonymous' })
        await placeImageOnCanvas(img, fabricCanvas)
      } catch (err: any) {
        alert(`Could not convert ${ext.toUpperCase()} file: ${err.message}`)
      }
      e.target.value = ''
      return
    }

    // PDF - rasterize first page using PDF.js
    if (ext === 'pdf') {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const page = await pdf.getPage(1)
        const viewport = page.getViewport({ scale: 2 })
        const offCanvas = document.createElement('canvas')
        offCanvas.width = viewport.width
        offCanvas.height = viewport.height
        const ctx = offCanvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas: offCanvas }).promise
        const dataUrl = offCanvas.toDataURL('image/png')
        const { FabricImage } = await import('fabric')
        const img = await FabricImage.fromURL(dataUrl)
        await placeImageOnCanvas(img, fabricCanvas)
      } catch (err) {
        alert('Could not load PDF. Make sure it is a valid PDF file.')
      }
      e.target.value = ''
      return
    }

    // SVG, PNG, JPEG, JPG, WEBP - direct load
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      const { FabricImage } = await import('fabric')
      const img = await FabricImage.fromURL(dataUrl)
      await placeImageOnCanvas(img, fabricCanvas)
      // Track uploaded file for order storage
      uploadedFilesRef.current = [...uploadedFilesRef.current, {
        name: file.name,
        url: dataUrl,
        type: file.type || ext
      }]
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const placeImageOnCanvas = async (img: any, canvas: any) => {
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    let spawnX = 340
    let spawnY = 425
    if (overlay && canvasEl) {
      const canvasRect = canvasEl.getBoundingClientRect()
      const overlayRect = overlay.getBoundingClientRect()
      const scaleX = canvasEl.width / canvasRect.width
      const scaleY = canvasEl.height / canvasRect.height
      spawnX = ((overlayRect.left - canvasRect.left) * scaleX) + (overlayRect.width * scaleX / 2)
      spawnY = ((overlayRect.top - canvasRect.top) * scaleY) + (overlayRect.height * scaleY / 2)
      // Scale to fit print area width
      const maxW = overlayRect.width * scaleX * 0.8
      if (img.width > maxW) img.scaleToWidth(maxW)
    } else {
      img.scaleToWidth(200)
    }
    img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
    canvas.add(img)
    canvas.setActiveObject(img)
    lastActiveObjectRef.current = img
    _activeObj = img
    canvas.renderAll()
  }

  // Export canvas as PNG blob - composite with shirt image using proxy to avoid CORS
  const exportCanvasPNG = async (canvas: any): Promise<Blob | null> => {
    return new Promise(async resolve => {
      try {
        const composite = document.createElement('canvas')
        composite.width = 680
        composite.height = 850
        const ctx = composite.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 680, 850)
        // Load shirt image via server proxy to avoid CORS in production
        const shirtSrc = shirtImgRef.current?.src
        if (shirtSrc && !shirtSrc.startsWith('data:')) {
          try {
            const proxyRes = await fetch(`/api/preview?shirt=${encodeURIComponent(shirtSrc)}`)
            if (proxyRes.ok) {
              const { shirt } = await proxyRes.json()
              await new Promise<void>(r => {
                const img = new Image()
                img.onload = () => {
                  const imgAspect = img.naturalWidth / img.naturalHeight
                  const canvasAspect = 680 / 850
                  let drawW = 680, drawH = 850, drawX = 0, drawY = 0
                  if (imgAspect > canvasAspect) {
                    drawH = 680 / imgAspect
                    drawY = (850 - drawH) / 2
                  } else {
                    drawW = 850 * imgAspect
                    drawX = (680 - drawW) / 2
                  }
                  ctx.drawImage(img, drawX, drawY, drawW, drawH)
                  r()
                }
                img.onerror = () => r()
                img.src = shirt
              })
            }
          } catch (e) {
            // fallback: try drawing directly
            if (shirtImgRef.current?.complete) {
              try { ctx.drawImage(shirtImgRef.current, 0, 0, 680, 850) } catch (_) {}
            }
          }
        } else if (shirtImgRef.current?.complete) {
          try { ctx.drawImage(shirtImgRef.current, 0, 0, 680, 850) } catch (_) {}
        }
        // Draw design canvas on top
        const designEl = canvasRef.current
        if (designEl) ctx.drawImage(designEl, 0, 0, 680, 850)
        composite.toBlob(blob => resolve(blob), 'image/png', 0.95)
      } catch (e) {
        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 2 })
        if (!dataUrl) return resolve(null)
        fetch(dataUrl).then(r => r.blob()).then(resolve).catch(() => resolve(null))
      }
    })
  }

  // Export canvas as SVG string
  const exportCanvasSVG = (canvas: any): string => {
    return canvas.toSVG() || ''
  }

  // Upload blob to Supabase storage
  const uploadToStorage = async (blob: Blob | string, path: string, bucket: string): Promise<string | null> => {
    const { supabase } = await import('../lib/supabase')
    const file = typeof blob === 'string'
      ? new Blob([blob], { type: 'image/svg+xml' })
      : blob
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true })
    if (error) { console.error('Storage upload error:', error); return null }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  }

  const saveDesignAndAddToCart = async () => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return null

    const orderId = crypto.randomUUID()
    const timestamp = Date.now()

    try {
      // 1. Export PNG for front (current view)
      const frontPng = await exportCanvasPNG(canvas)
      const frontSvg = exportCanvasSVG(canvas)

      // 2. Upload front PNG + SVG
      const [pngFrontUrl, svgFrontUrl] = await Promise.all([
        frontPng ? uploadToStorage(frontPng, `${orderId}/front.png`, 'design-exports') : null,
        frontSvg ? uploadToStorage(frontSvg, `${orderId}/front.svg`, 'design-exports') : null,
      ])

      // 3. Handle back canvas if designed
      let pngBackUrl = null, svgBackUrl = null
      if (backObjectsRef.current.length > 0) {
        // Temporarily load back objects to export
        const currentObjects = canvas.getObjects().map((o: any) => o)
        canvas.clear()
        backObjectsRef.current.forEach((o: any) => canvas.add(o))
        canvas.renderAll()
        const backPng = await exportCanvasPNG(canvas)
        const backSvg = exportCanvasSVG(canvas)
        ;[pngBackUrl, svgBackUrl] = await Promise.all([
          backPng ? uploadToStorage(backPng, `${orderId}/back.png`, 'design-exports') : null,
          backSvg ? uploadToStorage(backSvg, `${orderId}/back.svg`, 'design-exports') : null,
        ])
        // Restore front
        canvas.clear()
        currentObjects.forEach((o: any) => canvas.add(o))
        canvas.renderAll()
      }

      // 4. Upload any customer-uploaded files
      const uploadedFileUrls = await Promise.all(
        uploadedFilesRef.current.map(async (f, idx) => {
          if (!f.url.startsWith('data:')) return { name: f.name, url: f.url, type: f.type }
          const blob = await fetch(f.url).then(r => r.blob())
          const ext = f.name.split('.').pop() || 'png'
          const url = await uploadToStorage(blob, `${orderId}/uploads/${idx}_${f.name}`, 'customer-uploads')
          return { name: f.name, url: url || f.url, type: f.type }
        })
      )

      // 5. Save to design_orders table
      const { supabase } = await import('../lib/supabase')
      const { data: order, error } = await supabase.from('design_orders').insert({
        id: orderId,
        shopify_product_id: product?.id || '',
        shopify_variant_id: selectedVariant?.id || '',
        product_title: productTitle,
        selected_color: selectedColor,
        print_method: printMethod,
        sides_designed: sidesCount,
        // Day 3: which template / print areas this design used, plus a frozen
        // geometry snapshot for print-file fidelity (survives later admin edits).
        template_id: templateIdRef.current,
        print_area_front_id: printAreaFrontIdRef.current,
        print_area_back_id: printAreaBackIdRef.current,
        print_area_front: printAreaFrontSnapRef.current,
        print_area_back: printAreaBackSnapRef.current,
        canvas_png_front: pngFrontUrl,
        canvas_png_back: pngBackUrl,
        canvas_svg_front: svgFrontUrl,
        canvas_svg_back: svgBackUrl,
        canvas_json_front: JSON.stringify(canvas.toJSON()),
        canvas_json_back: JSON.stringify(backObjectsRef.current.map((o: any) => o.toJSON?.() || {})),
        uploaded_files: uploadedFileUrls,
        quantities,
        available_sizes: SIZES.filter(s => isSizeAvailable(s)),
        unit_price: unitPrice,
        print_charge: printCharge,
        price_per_item: pricePerItem,
        total_qty: totalQty,
        total_price: parseFloat(total),
        status: 'draft'
      }).select().single()

      if (error) { console.error('Order save error:', error); return null }
      console.log('Design saved:', orderId)

      // Cart creation happens on the order page (/order), where the customer
      // picks sizes and quantities. Nothing more to do here.
      return { orderId }
    } catch (err) {
      console.error('Save design error:', err)
      return null
    }
  }

  const deleteSelected = () => {
    if (!fabricCanvas) return
    const active = fabricCanvas.getActiveObject()
    if (active) { fabricCanvas.remove(active); fabricCanvas.renderAll() }
  }

  const unitPrice = selectedVariant
    ? parseFloat(selectedVariant.price.amount)
    : productPrice || 18
  const totalQty = Object.values(quantities).reduce((a, b) => a + b, 0)
  // Which specific sides carry design content. The active view's objects live on
  // the live canvas; the opposite view's objects are swapped out into its ref on
  // view switch. So for the current view trust the live canvas (falling back to
  // its ref), and for the other view read its ref.
  const liveCount = fabricCanvasRef.current?.getObjects()?.length || 0
  const frontHasContent = shirtView === 'front'
    ? (liveCount > 0 || frontObjectsRef.current.length > 0)
    : frontObjectsRef.current.length > 0
  const backHasContent = shirtView === 'back'
    ? (liveCount > 0 || backObjectsRef.current.length > 0)
    : backObjectsRef.current.length > 0
  const sidesCount = (frontHasContent ? 1 : 0) + (backHasContent ? 1 : 0)
  // Per-side surcharge. designer_pricing.sides is a SIDE IDENTITY (1 = Front,
  // 2 = Back), NOT a count — each side is charged independently. Sum the price
  // for each side that has content rather than looking up by the number of
  // sides (the old `printPricing[sidesCount]` charged a 2-sided design the
  // single Back-row price, e.g. $12 instead of $12 + $12 = $24).
  const printCharge =
    (frontHasContent ? (printPricing[1] ?? 12) : 0) +
    (backHasContent ? (printPricing[2] ?? 12) : 0)
  const pricePerItem = unitPrice + printCharge
  const total = (totalQty * pricePerItem).toFixed(2)

  // Serialize enough of the current design to fully rebuild it after a login
  // round-trip. The live canvas holds the current view's objects; the other
  // view lives in its ref. Returns null when there's nothing worth saving.
  const snapshotDesignState = () => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return null
    // Custom props Fabric's default serializer drops but we rely on for editing
    // affordances (SVG recolor, uppercase toggle, curved-text identity).
    const CUSTOM_PROPS = ['_isSvg', '_originalText', '_currentColor', '_isCurvedText']
    const liveJson = canvas.toObject(CUSTOM_PROPS)
    const serializeRef = (objs: any[]) => ({
      version: liveJson.version,
      objects: objs.map((o: any) => (o.toObject ? o.toObject(CUSTOM_PROPS) : o)),
    })

    const front = shirtView === 'back' ? serializeRef(frontObjectsRef.current) : liveJson
    const back = shirtView === 'back' ? liveJson : serializeRef(backObjectsRef.current)

    const hasFront = (front.objects?.length || 0) > 0
    const hasBack = (back.objects?.length || 0) > 0
    if (!hasFront && !hasBack) return null

    return {
      schemaVersion: 1,
      productId: product?.id || productId,
      variantId: selectedVariant?.id || '',
      productTitle,
      productPrice,
      selectedColor,
      shirtView,
      printMethod,
      quantities,
      sidesDesigned: sidesCount,
      front,
      back,
      uploadedFiles: uploadedFilesRef.current,
    }
  }

  // Called by CustomerAuthButton before it redirects to Shopify login. Writes a
  // draft row and returns the path to come back to (this page + ?restore=<id>),
  // so the customer's work is restored on return. null → button falls back to
  // returning to the current URL with no restore (still logs in, no data lost
  // beyond the unsaved canvas).
  const prepareLoginRedirect = async (): Promise<string | null> => {
    const state = snapshotDesignState()
    if (!state) return null
    try {
      const res = await fetch('/api/designs/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(state),
      })
      if (!res.ok) return null
      const { draftId } = await res.json()
      if (!draftId) return null
      const params = new URLSearchParams(window.location.search)
      params.set('restore', draftId)
      return `${window.location.pathname}?${params.toString()}`
    } catch (err) {
      console.error('[designer] draft snapshot failed:', err)
      return null
    }
  }

  return (
    <div className="flex flex-col h-screen text-gray-900" style={{ fontFamily: 'DM Sans, sans-serif' }}>

      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-gray-200 shrink-0">
        <div className="font-black text-xl tracking-widest">
          TEE<span className="text-[#dd3333]">STUDIO</span>
        </div>
        <div className="text-sm text-gray-800 truncate max-w-xs">{productTitle}</div>
        <div className="flex items-center gap-3">
          <CustomerAuthButton variant="quiet" onBeforeLogin={prepareLoginRedirect} />
          <button
            onClick={async () => {
              const canvas = (window as any)._fabricCanvas
              if (!canvas || canvas.getObjects().length === 0) {
                alert('Please add a design before continuing. Add text, clipart, or upload an image.')
                return
              }
              // Deselect all objects so handles don't show in preview
              canvas.discardActiveObject()
              canvas.renderAll()
              const btn = document.querySelector('[data-cart-btn]') as HTMLButtonElement
              if (btn) { btn.textContent = 'Saving...'; (btn as any).disabled = true }
              const result = await saveDesignAndAddToCart()
              if (btn) { btn.textContent = 'Next Step →'; (btn as any).disabled = false }
              if (result && result.orderId) {
                window.location.href = `/order?design_id=${result.orderId}`
              } else {
                alert('Error saving design. Please try again.')
              }
            }}
            data-cart-btn
            className="bg-[#dd3333] text-white px-5 py-2 rounded text-sm font-bold tracking-wide hover:opacity-80 transition-opacity">
            Next Step →
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel */}
        <aside className="w-72 bg-white border-r border-gray-200 flex flex-col overflow-y-auto shrink-0">
          <div className="grid grid-cols-3 gap-1 p-2 bg-gray-100 m-3 rounded-lg">
            {(['text', 'upload', 'clipart'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`py-2 rounded text-xs font-mono capitalize transition-all ${
                  activeTab === tab ? 'bg-[#dd3333] text-white font-bold' : 'text-gray-800 hover:text-white'
                }`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4 flex flex-col gap-4">

                        {/* TEXT TAB */}
            {activeTab === 'text' && (
              <>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Your Text</label>
                  <input type="text" value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addText()}
                    placeholder="Type something..."
                    className="w-full mt-1 bg-gray-100 border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333]"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Font</label>
                  <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto pr-1">
                    {(dbFonts.length > 0 ? dbFonts : fonts).map(f => (
                      <button key={f.value} onClick={() => setSelectedFont(f.value)}
                        className={`w-full text-left px-3 py-2 rounded border transition-all ${
                          selectedFont === f.value
                            ? 'border-[#dd3333] bg-[#dd3333]/10'
                            : 'border-gray-200 bg-gray-100 hover:border-[#444]'
                        }`}>
                        <div className="text-xs text-gray-800 font-mono mb-0.5">{f.label}</div>
                        <div style={{ fontFamily: f.value, fontSize: '18px', color: '#161616', lineHeight: 1.2 }}>
                          {selectedTextPreview || textInput || 'Preview Text'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Size</label>
                    <input type="number" min={8} max={120} value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      className="w-14 bg-gray-100 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none text-center focus:border-[#dd3333]"
                    />
                  </div>
                  <input type="range" min={8} max={120} value={fontSize}
                    onChange={e => setFontSize(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Letter Spacing</label>
                    <span className="text-xs text-[#dd3333] font-mono">{letterSpacing}</span>
                  </div>
                  <input type="range" min={-5} max={30} value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Text Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {(dbColors.length > 0 ? dbColors : [
                      { label: 'White', hex: '#ffffff' },
                      { label: 'Black', hex: '#000000' },
                    ]).map(c => (
                      <button key={c.hex} onClick={() => setTextColor(c.hex)}
                        title={c.label}
                        style={{
                          background: c.hex,
                          border: c.hex === '#ffffff' ? '1px solid #555' : 'none'
                        }}
                        className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                          textColor === c.hex
                            ? 'ring-2 ring-[#dd3333] ring-offset-1 ring-offset-[#161616]'
                            : ''
                        }`}
                      />
                    ))}
                    <input type="color" value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded-full cursor-pointer overflow-hidden"
                      title="Custom color" />
                  </div>
                  {dbColors.length > 0 && (
                    <p className="text-xs text-gray-800 mt-1 font-mono">
                      {dbColors.find(c => c.hex === textColor)?.label || 'Custom'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Direction</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button onClick={() => setTextDirection('horizontal')}
                      className={`py-2 rounded text-xs font-mono transition-all ${textDirection === 'horizontal' ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      — Horizontal
                    </button>
                    <button onClick={() => setTextDirection('vertical')}
                      className={`py-2 rounded text-xs font-mono transition-all ${textDirection === 'vertical' ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      ↕ Vertical
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Curve</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-800 font-mono">{curveAmount > 0 ? `+${curveAmount}` : curveAmount}</span>
                      <button onClick={() => setCurveAmount(0)}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${curveAmount !== 0 ? 'bg-[#dd3333] text-white' : 'bg-gray-200 text-gray-800'}`}>
                        Straight
                      </button>
                    </div>
                  </div>
                  <input type="range" min="-100" max="100" value={curveAmount}
                    onChange={e => setCurveAmount(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                  <div className="flex justify-between text-[9px] text-gray-800 font-mono mt-0.5">
                    <span>⌣ Down</span>
                    <span>|</span>
                    <span>⌢ Up</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Text Align</label>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map(align => (
                      <button key={align}
                        onClick={() => {
                          setTextAlign(align)
                          const canvas = (window as any)._fabricCanvas
                          const obj = canvas?.getActiveObject()
                          if (obj && obj.type === 'textbox') {
                            obj.set('textAlign', align)
                            canvas.renderAll()
                          }
                        }}
                        className={`flex-1 py-1.5 rounded text-xs font-mono border transition-all ${
                          textAlign === align
                            ? 'bg-[#dd3333] text-white border-[#dd3333]'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-[#dd3333]'
                        }`}>
                        {align === 'left' ? (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="0" y="5" width="10" height="2"/>
                            <rect x="0" y="10" width="12" height="2"/>
                          </svg>
                        ) : align === 'center' ? (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="2" y="5" width="10" height="2"/>
                            <rect x="1" y="10" width="12" height="2"/>
                          </svg>
                        ) : (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="4" y="5" width="10" height="2"/>
                            <rect x="2" y="10" width="12" height="2"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Effects</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <button onClick={() => setIsBold(b => !b)}
                      className={`py-2 rounded text-xs font-bold transition-all ${isBold ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      Bold
                    </button>
                    <button onClick={() => setIsItalic(i => !i)}
                      className={`py-2 rounded text-xs italic transition-all ${isItalic ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      Italic
                    </button>
                    <button onClick={() => setIsUppercase(u => !u)}
                      className={`py-2 rounded text-xs font-mono transition-all ${isUppercase ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      AA
                    </button>

                  </div>
                </div>
                <button onClick={addText}
                  className="w-full bg-[#dd3333] text-white py-3 rounded font-bold text-sm tracking-wide hover:opacity-85 transition-opacity">
                  + Add to Shirt
                </button>
                <button onClick={deleteSelected}
                  className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                  Delete Selected
                </button>
              </>
            )}
            {/* UPLOAD TAB */}
            {activeTab === 'upload' && (
              <div>
                <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Upload Artwork</label>
                <label className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-[#dd3333] hover:bg-[#dd3333]/5 transition-all">
                  <span className="text-3xl mb-3">⬆</span>
                  <span className="text-sm text-gray-800 text-center">
                    Drop image here<br />
                    <span className="text-xs opacity-60">PNG, SVG, JPG, JPEG, PDF</span>
                    <span className="text-[10px] opacity-40 mt-0.5 block">AI · EPS · PSD supported via Cloudinary</span>
                  </span>
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.eps,.psd" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
            )}

            {/* CLIPART TAB */}
            {activeTab === 'clipart' && (
              <div className="flex flex-col gap-3">
                <ClipartPanel
                  printMethod={printMethod}
                  onSelect={(url, fileType) => {
                    if (!fabricCanvas) return
                    const canvasEl = canvasRef.current
                    const overlay = document.querySelector('[data-print-area]') as HTMLElement
                    let spawnX = 280, spawnY = 378
                    if (overlay && canvasEl) {
                      const canvasRect = canvasEl.getBoundingClientRect()
                      const overlayRect = overlay.getBoundingClientRect()
                      const scaleX = canvasEl.width / canvasRect.width
                      const scaleY = canvasEl.height / canvasRect.height
                      spawnX = ((overlayRect.left - canvasRect.left) * scaleX) + (overlayRect.width * scaleX / 2)
                      spawnY = ((overlayRect.top - canvasRect.top) * scaleY) + (overlayRect.height * scaleY / 2)
                    }
                    import('fabric').then(({ FabricImage }) => {
                      FabricImage.fromURL(url, { crossOrigin: 'anonymous' }).then(img => {
                        const canvasEl = canvasRef.current
                        const overlay = document.querySelector('[data-print-area]') as HTMLElement
                        if (overlay && canvasEl) {
                          const canvasRect = canvasEl.getBoundingClientRect()
                          const overlayRect = overlay.getBoundingClientRect()
                          const scaleX = canvasEl.width / canvasRect.width
                          const maxW = overlayRect.width * scaleX * 0.5
                          if (img.width > maxW) img.scaleToWidth(maxW)
                        }
                        img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
                        ;(img as any)._isSvg = fileType === 'svg'
                        fabricCanvas.add(img)
                        fabricCanvas.setActiveObject(img)
                        lastActiveObjectRef.current = img
                        setSelectedSvgColor('#000000')
                        fabricCanvas.renderAll()
                      })
                    })
                  }}
                />
                {/* SVG Color swatches */}
                <div className="mt-2">
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Clipart Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {(dbColors.length > 0 ? dbColors : [
                      { label: 'Black', hex: '#000000' },
                      { label: 'White', hex: '#ffffff' },
                    ]).map(c => (
                      <button key={c.hex} onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
                        title={c.label}
                        style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #555' : 'none' }}
                        className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                          selectedSvgColor === c.hex ? 'ring-2 ring-[#dd3333] ring-offset-2 ring-offset-[#161616]' : ''
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-800 mt-1 font-mono">
                    {(dbColors.length > 0 ? dbColors : [{ label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' }]).find(c => c.hex === selectedSvgColor)?.label || selectedSvgColor || 'Black'}
                  </p>
                </div>
                <button onClick={deleteSelected}
                  className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors mt-2">
                  Delete Selected
                </button>
              </div>
            )}

          </div>
        </aside>

        {/* Canvas center */}
        <section className="flex-1 flex flex-col items-center justify-center bg-gray-50 relative overflow-hidden">

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-800 text-sm z-10">
              Loading canvas...
            </div>
          )}

          {/* Persistent alignment toolbar */}
          <div className="flex items-center gap-1 mb-2 px-1 flex-wrap">
            <span className="text-xs text-gray-800 font-mono uppercase tracking-widest mr-1">Align:</span>
            {[
              { label: '⬛◻◻', title: 'Align Left', fn: 'left' },
              { label: '◻⬛◻', title: 'Align Center', fn: 'center' },
              { label: '◻◻⬛', title: 'Align Right', fn: 'right' },
              { label: '⬆', title: 'Align Top', fn: 'top' },
              { label: '↕', title: 'Align Middle', fn: 'middle' },
              { label: '⬇', title: 'Align Bottom', fn: 'bottom' },
            ].map(({ label, title, fn }) => (
              <button key={fn} title={title}
                onPointerDown={e => {
                  e.preventDefault()
                  ;(window as any)._alignObject?.(fn)
                }}
                className="px-2 py-1 rounded text-xs font-mono bg-gray-100 border border-gray-200 text-gray-800 hover:border-[#dd3333] hover:text-gray-900 transition-all">
                {label}
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200 mx-1" />
            <button
              title="Clear all objects from canvas"
              onPointerDown={e => {
                e.preventDefault()
                if (!confirm('Clear all design elements?')) return
                const canvas = (window as any)._fabricCanvas
                if (!canvas) return
                canvas.clear()
                canvas.renderAll()
              }}
              className="px-2 py-1 rounded text-xs font-mono bg-gray-100 border border-gray-200 text-red-500 hover:border-red-700 hover:bg-red-900/20 transition-all">
              Clear All
            </button>
          </div>
          <div className="relative" style={{ width: 680, height: 850 }}>
            <img
              ref={shirtImgRef}
              alt="Shirt preview"
              crossOrigin="anonymous"
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%', height: '100%',
                objectFit: 'contain',
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            <canvas
              ref={canvasRef}
              style={{ position: 'absolute', top: 0, left: 0 }}
            />
            {printArea && (
              <div data-print-area="true" style={{
                position: 'absolute',
                left: `${printArea.xPct}%`,
                top: `${printArea.yPct}%`,
                width: `${printArea.widthPct}%`,
                height: `${printArea.heightPct}%`,
                border: '1.5px dashed rgba(0,0,0,0.7)',
                borderRadius: '2px',
                pointerEvents: 'none',
                zIndex: 2,
                boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7)',
              }}>

              </div>
            )}
          </div>

          {/* Front / Back toggle */}
          <div className="absolute bottom-5 flex gap-2">
            <button
              onClick={() => {
                if (shirtView === 'front') return
                // Save back objects, restore front objects
                const canvas = fabricCanvasRef.current
                if (canvas) {
                  backObjectsRef.current = canvas.getObjects().map((o: any) => o)
                  canvas.clear()
                  frontObjectsRef.current.forEach((o: any) => canvas.add(o))
                  canvas.renderAll()
                }
                setShirtView('front')
                const imgs = getColorImages(selectedColor, colorImageMap)
                if (imgs?.front && shirtImgRef.current) shirtImgRef.current.src = imgs.front
                if (window._printAreaData?.front) { setPrintArea(window._printAreaData.front); window.dispatchEvent(new Event('printAreaChanged')) }
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-mono tracking-widest transition-all ${
                shirtView === 'front'
                  ? 'bg-[#dd3333] text-white'
                  : 'bg-white text-gray-800 border border-gray-200'
              }`}
            >
              FRONT
            </button>
            {hasBackImages && shirtView === 'front' && frontObjectsRef.current.length > 0 && (
              <button
                onClick={() => {
                  const canvas = fabricCanvasRef.current
                  if (!canvas) return
                  import('fabric').then(async ({ util }) => {
                    const copies = await Promise.all(
                      frontObjectsRef.current.map((o: any) => o.clone())
                    )
                    backObjectsRef.current = copies
                  })
                }}
                className="px-3 py-1.5 rounded-full text-xs font-mono tracking-widest bg-white text-gray-800 border border-gray-200 hover:border-[#dd3333] hover:text-gray-900 transition-all">
                Copy to Back
              </button>
            )}
            {hasBackImages && shirtView === 'back' && backObjectsRef.current.length > 0 && (
              <button
                onClick={() => {
                  const canvas = fabricCanvasRef.current
                  if (!canvas) return
                  import('fabric').then(async () => {
                    const copies = await Promise.all(
                      backObjectsRef.current.map((o: any) => o.clone())
                    )
                    frontObjectsRef.current = copies
                  })
                }}
                className="px-3 py-1.5 rounded-full text-xs font-mono tracking-widest bg-white text-gray-800 border border-gray-200 hover:border-[#dd3333] hover:text-gray-900 transition-all">
                Copy to Front
              </button>
            )}
            {hasBackImages && (
              <button
                onClick={() => {
                  if (shirtView === 'back') return
                  // Save front objects, restore back objects
                  const canvas = fabricCanvasRef.current
                  if (canvas) {
                    frontObjectsRef.current = canvas.getObjects().map((o: any) => o)
                    canvas.clear()
                    backObjectsRef.current.forEach((o: any) => canvas.add(o))
                    canvas.renderAll()
                  }
                  setShirtView('back')
                  const imgs = getColorImages(selectedColor, colorImageMap)
                  if (imgs?.back && shirtImgRef.current) shirtImgRef.current.src = imgs.back
                  if (window._printAreaData?.back) { setPrintArea(window._printAreaData.back); window.dispatchEvent(new Event('printAreaChanged')) }
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-mono tracking-widest transition-all ${
                  shirtView === 'back'
                    ? 'bg-[#dd3333] text-white'
                    : 'bg-white text-gray-800 border border-gray-200'
                }`}
              >
                BACK
              </button>
            )}
          </div>
        </section>

        {/* Right panel */}
        <aside className="w-64 bg-white border-l border-gray-200 flex flex-col gap-4 p-4 overflow-y-auto shrink-0">
          <h2 className="font-black text-lg tracking-widest">ORDER</h2>

          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between text-gray-800">
              <span>Product</span>
              <span className="text-gray-900 text-right text-xs max-w-[120px] truncate">{productTitle}</span>
            </div>
            <div className="flex justify-between text-gray-800">
              <span>Color</span>
              <span className="text-gray-900 text-xs">{selectedColor || '—'}</span>
            </div>
            {/* Color swatches */}
            {!product && (
              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
                ))}
              </div>
            )}
            {product && colors.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {colors.map(color => (
                  <div key={color} className="relative group">
                    <button
                      onClick={() => handleColorSelect(color)}
                      style={{
                        background: COLOR_HEX_MAP[color] || '#888',
                        border: ['White', 'Natural'].includes(color) ? '1px solid #555' : 'none'
                      }}
                      className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${
                        selectedColor === color
                          ? 'ring-2 ring-[#dd3333] ring-offset-2 ring-offset-[#161616]'
                          : ''
                      }`}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between text-gray-800">
              <span>Blank price</span>
              <span className="text-gray-900">{`$${unitPrice.toFixed(2)}`}</span>
            </div>
            {printCharge > 0 && (
              <div className="flex justify-between text-gray-800">
                <span>Print charge ({sidesCount} side{sidesCount > 1 ? 's' : ''})</span>
                <span className="text-gray-900">{`+$${printCharge.toFixed(2)}`}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
              <span className="text-gray-800">Price per item</span>
              <span className="text-[#dd3333]">{`$${pricePerItem.toFixed(2)}`}</span>
            </div>
          </div>

          <div className="h-px bg-gray-200" />

          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-gray-800">
              <span>Total qty</span>
              <span className="text-gray-900">{totalQty}</span>
            </div>
            <div className="flex justify-between text-gray-800">
              <span>Total</span>
              <span className="text-gray-900">{`$${total}`}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
