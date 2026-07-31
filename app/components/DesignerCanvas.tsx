'use client'
// Module-level variable to persist active object across button clicks
let _activeObj: any = null

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import CanvasStage from './CanvasStage'
import { getProduct } from '../lib/shopify'
import { buildColorImageMap, getColorImages } from '../lib/productImages'
import { toPctContain, CANVAS_W, CANVAS_H, type PrintAreaPct } from '../lib/printAreaGeometry'
import ActionBar from './ActionBar'
import Stepper from './Stepper'
import Rail from './Rail'
import SelectionPanel from './SelectionPanel'
import MobileToolSheet from './MobileToolSheet'
import { type UploadItem } from './MyUploadsPanel'
import MyDesignsDrawer, { type SavedDesign } from './MyDesignsDrawer'
import { useCustomerSession } from '../hooks/useCustomerSession'

// Uploads a File/Blob/data-URI to Cloudinary (unsigned preset) and returns the
// hosted image URL + metadata, or null if Cloudinary isn't configured or the
// upload fails. Used to give every "My Uploads" library entry a durable URL;
// the designer still works without Cloudinary (the library just won't persist).
async function uploadToCloudinary(
  file: File | Blob | string,
): Promise<{ url: string; publicId: string; width?: number; height?: number } | null> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
  if (!cloudName || !uploadPreset) return null
  try {
    const fd = new FormData()
    fd.append('file', file as Blob)
    fd.append('upload_preset', uploadPreset)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: fd,
    })
    if (!res.ok) return null
    const data = await res.json()
    return { url: data.secure_url, publicId: data.public_id, width: data.width, height: data.height }
  } catch {
    return null
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

// Props Fabric's default serializer drops but we rely on. `_uploadSrc` is the
// stamp that ties a placed image back to its uploaded file — see the used-files
// filter in saveDesignAndAddToCart.
const CANVAS_CUSTOM_PROPS = ['_isSvg', '_originalText', '_currentColor', '_isCurvedText', '_uploadSrc',
  // Bake params for a curved-text image, so selecting it reflects the curve
  // slider + font/size/color and adjusting the curve re-bakes from its OWN values.
  '_curveAmount', '_curveFontFamily', '_curveFontSize', '_curveFill', '_curveBold', '_curveItalic']

// Fallback size list ONLY — real sizes come per-product from the Shopify Size
// option (see productSizes). Used when a product exposes no Size option.
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']

// buildColorImageMap / getColorImages now live in ../lib/productImages (shared
// with the template admin) and match by color-name-contains rather than a rigid
// filename parse.

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
  // Per-template garment colors (hex + optional swatch image), keyed by color
  // name. Loaded from product_template_colors; drives the swatch rendering and
  // the selected_color_hex capture, with COLOR_HEX_MAP as the fallback for
  // non-templated products.
  const [templateColors, setTemplateColors] = useState<Record<string, { hex: string; swatch_image_url: string | null }>>({})
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
  // Reactive count of objects on the CURRENT side's canvas — drives the blank-shirt
  // empty-state overlay (greeting + on-garment CTAs). Updated on object:added/removed.
  const [canvasObjectCount, setCanvasObjectCount] = useState(0)

  // ── Mobile (BLOCKER-2, canvas-scaling pass) ──────────────────────────────────
  // Below the lg breakpoint (1024px — tablets are touch users too), CSS-scale the
  // fixed 680×850 stage to fit the canvas area. The COORDINATE space stays 680×850
  // (objects/bounds/saves unchanged); only the DISPLAY scales — Fabric's pointer
  // math and our bounds math both read getBoundingClientRect, which includes the
  // transform, so it's scale-invariant. On DESKTOP `isMobile` is false → stageScale
  // stays 1 → NO transform → layout byte-identical (proven by the parity harness).
  const stageAreaRef = useRef<HTMLElement>(null)
  const [isMobile, setIsMobile] = useState(false)
  const [stageScale, setStageScale] = useState(1)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!isMobile) { setStageScale(1); return }
    const el = stageAreaRef.current
    if (!el) return
    const compute = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (w > 0 && h > 0) setStageScale(Math.min(w / 680, h / 850, 1))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile])

  // Mobile tool sheet (pass 3): peek / half / full. Selecting an object on the
  // shirt auto-opens the sheet to HALF so its controls are findable (drag down
  // dismisses) — the selection-aware design, on mobile.
  const [sheetSnap, setSheetSnap] = useState<'peek' | 'half' | 'full'>('peek')
  useEffect(() => {
    if (isMobile && selectedObjectType) setSheetSnap(s => (s === 'peek' ? 'half' : s))
  }, [selectedObjectType, isMobile])

  // Helper to constrain all objects on canvas after property changes
  const constrainAllObjects = () => {
    if (!fabricCanvas) return
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return
    const canvasRect = canvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const scaleX = CANVAS_W  / canvasRect.width
    const scaleY = CANVAS_H / canvasRect.height
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
  // Quantities keyed by the product's REAL sizes — populated on product load
  // (see productSizes). Starts empty so we never assume the adult size set.
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  // The product's sizes in Shopify's variant order (the merchant's intended
  // display order — never alphabetized: "3-6mo, 6-12mo" and "S, M, L" both
  // break under a sort). Falls back to module SIZES only if a product has no
  // Size option.
  const [productSizes, setProductSizes] = useState<string[]>([])

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
    // Restore an existing order into the designer ("Edit design" flow). Reads
    // BOTH sides: front loads into the live canvas (restore lands on Front),
    // and back is enlivened into backObjectsRef so the Back toggle rehydrates
    // it — mirroring the login-restore path's enlivenObjects usage. Without
    // back restoration, the Day-4 view-aware save would overwrite the back to
    // null on the Edit round-trip.
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      const canvas = fabricCanvasRef.current
      if (!canvas) { if (attempts > 20) clearInterval(poll); return }
      clearInterval(poll)
      // BLOCKER-1 lockdown: reads flow through the server route (service
      // role) — the public RLS read policy is gone. Same URL-as-key
      // semantics: the exact UUID is required, enumeration is impossible.
      // uploaded_files rides along: without it uploadedFilesRef starts EMPTY
      // on this path, so the used-files filter has nothing to match against
      // and the order carries zero files no matter how good the stamps are.
      fetch(`/api/design-orders/${designId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (payload) => {
          const data = payload?.order as {
            canvas_json_front: string | null
            canvas_json_back: string | null
            uploaded_files: unknown
          } | undefined
          if (!data) return
          try {
            const { util } = await import('fabric')
            if (data.canvas_json_front) {
              const frontJson = JSON.parse(data.canvas_json_front)
              if (frontJson.objects?.length > 0) await canvas.loadFromJSON(frontJson)
            }
            if (data.canvas_json_back) {
              const backJson = JSON.parse(data.canvas_json_back)
              backObjectsRef.current = backJson.objects?.length
                ? (await util.enlivenObjects(backJson.objects)) as any[]
                : []
            }
            if (Array.isArray(data.uploaded_files)) {
              uploadedFilesRef.current = data.uploaded_files as typeof uploadedFilesRef.current
            }
            canvas.discardActiveObject()
            canvas.renderAll()
          } catch (e) { /* ignore restore errors */ }
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
    if (reflectingRef.current) return  // mirror-on-select, not a real knob change
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
        baseText, currentFontSize, selectedFont, isBold, isItalic, letterSpacing * 10
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
        const scaleX = CANVAS_W / canvasRect.width
        const scaleY = CANVAS_H / canvasRect.height
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
  // `url` is the DISPLAY rendition (what's on the canvas). `originalUrl` is the
  // file the customer actually uploaded — set only when they differ, i.e. when we
  // converted (AI/PSD/EPS/PDF). The print shop needs the original, not the PNG.
  const uploadedFilesRef = useRef<
    { name: string; url: string; type: string; originalUrl?: string; originalFormat?: string }[]
  >([])
  // Product's first/featured image — the shirt fallback when a color resolves no
  // matching mockup (so we never show a blank canvas; the gap is flagged in the
  // template admin's Colors section instead).
  const firstImageUrlRef = useRef<string>('')
  // The canvas event handlers below are registered ONCE, so they must not read
  // panel state directly or they'd close over the first render's values forever.
  // These refs give them a live view of the two things the fit contract needs.
  const fontSizeRef = useRef(fontSize)
  const isUppercaseRef = useRef(isUppercase)
  useEffect(() => { fontSizeRef.current = fontSize }, [fontSize])
  useEffect(() => { isUppercaseRef.current = isUppercase }, [isUppercase])

  // Pull-on-select guard. The panel is otherwise PUSH-only: the style/size/
  // dirty/curve effects below watch the knob states and WRITE them onto the
  // active object. When we select a text and mirror ITS properties back into
  // those knobs (reflectTextObject), we must NOT let that mirror fire the push
  // effects — they'd re-apply values (harmless) but also reset scaleX/scaleY to
  // 1 (visibly resizing a hand-scaled text) and mark the design dirty on mere
  // selection. reflectingRef makes the mirror inert; a last-declared effect
  // clears it after the guarded effects have flushed in the same commit.
  const reflectingRef = useRef(false)

  // Curve re-bake pacing (Bug #1: the slider used to rasterize+swap on every
  // input tick → the tool "shook"). curveRafRef coalesces bakes to one per
  // animation frame (live but not per-tick). curveTokenRef drops any bake
  // superseded by a newer one before its async image decode finishes (the
  // overlapping-async hazard). curveBakingRef flags the re-bake's re-selection
  // so the selection handlers keep the refs but skip the panel reflect/tab churn.
  const curveRafRef = useRef<number | null>(null)
  const curveTokenRef = useRef(0)
  const curveBakingRef = useRef(false)

  // Mirror a selected text object's real properties into the panel knobs, so the
  // panel reflects THAT object (fixes the logged color-swatch gap AND the latent
  // "touch one knob → the text snaps to the panel's defaults" clobber — once the
  // knobs hold the object's own values, the push effects re-apply identical
  // ones). Handles both a live IText and a curved-text baked image, which reads
  // its stamped bake params instead (the _isCurvedText branch below).
  const reflectTextObject = (obj: any) => {
    reflectingRef.current = true
    // Curved text is a baked image — its type/props aren't live, so read the
    // params we stamped at curve time. Only the props the curve effect uses are
    // mirrored (spacing/align/direction/case don't apply to a single arc); this
    // keeps the curve slider + font/size/color truthful, so adjusting the curve
    // re-bakes from the text's OWN values.
    if (obj._isCurvedText) {
      setSelectedFont(obj._curveFontFamily || selectedFont)
      setFontSize(Math.round(obj._curveFontSize || fontSize))
      setTextColor(typeof obj._curveFill === 'string' ? obj._curveFill : textColor)
      setIsBold(!!obj._curveBold)
      setIsItalic(!!obj._curveItalic)
      setCurveAmount(obj._curveAmount ?? 0)
      return
    }
    const fill = typeof obj.fill === 'string' ? obj.fill : textColor
    const orig = (obj._originalText ?? '') as string
    const flat = (obj.text || '').replace(/\n/g, ' ')
    // Uppercase isn't a stored flag: it's ON iff the displayed text is the
    // original upper-cased AND the original actually had lowercase to fold
    // (an already-all-caps source reads as OFF, harmlessly — re-upper is a no-op).
    const uppercase = !!orig && orig !== orig.toUpperCase() && flat === orig.toUpperCase()
    setSelectedFont(obj.fontFamily || selectedFont)
    setFontSize(Math.round(obj.fontSize || fontSize))
    setTextColor(fill)
    setLetterSpacing(Math.round((obj.charSpacing || 0) / 10))
    setIsBold(obj.fontWeight === 'bold' || obj.fontWeight === 700)
    setIsItalic(obj.fontStyle === 'italic')
    setIsUppercase(uppercase)
    setTextAlign(obj.textAlign === 'left' || obj.textAlign === 'right' ? obj.textAlign : 'center')
    setTextDirection(obj.angle === 90 ? 'vertical' : 'horizontal')
    setCurveAmount(0)
  }

  // Which rail section an object belongs to. Selecting an object sets activeTab
  // to this, so the rail highlight AND the panel both follow what you're editing
  // (they read the same activeTab — they can't disagree).
  //
  // Text objects AND curved-text baked images (`_isCurvedText`) both map to 'text'
  // so a curved text keeps the Text panel + curve slider (Issue-1 fix — no more
  // jump to Upload). Otherwise the discriminator is `_isSvg`, NOT `_uploadSrc`:
  // clipart stamps `_isSvg` (true for SVG, false for raster) at creation, BEFORE
  // setActiveObject fires the selection event, so it's reliably present; `_uploadSrc`
  // is stamped AFTER the upload is placed+selected, so it's undefined at selection
  // time (a fresh upload would misroute). So clipart→Art; any other image→Upload.
  const sectionForObject = (obj: any): 'text' | 'upload' | 'clipart' => {
    if (obj?.type === 'i-text' || obj?.type === 'textbox') return 'text'
    if (obj?._isCurvedText) return 'text'
    if (typeof obj?._isSvg === 'boolean') return 'clipart'
    return 'upload'
  }

  // Has the canvas changed since the last successful save? Drives the Save
  // button's "Saved ✓" vs "Save changes" state.
  //
  // Marked from USER-INTENT actions plus object:modified (which only fires on a
  // real drag/scale/rotate). Deliberately NOT object:added/removed — those also
  // fire during programmatic rebuilds (switching sides clears and re-adds the
  // canvas; restore repopulates it), which would claim "unsaved changes" when
  // the customer changed nothing.
  const [isDirty, setIsDirty] = useState(false)
  const markDirty = () => setIsDirty(true)

  // Every style control is a design change. Guarded so this effect's own mount
  // run doesn't declare a fresh, untouched canvas dirty.
  const styleDirtyMounted = useRef(false)
  useEffect(() => {
    if (!styleDirtyMounted.current) { styleDirtyMounted.current = true; return }
    if (reflectingRef.current) return  // selecting a text isn't a design change
    markDirty()
  }, [selectedFont, textColor, isBold, isItalic, isUppercase, textAlign,
      letterSpacing, textDirection, textOutline, curveAmount, fontSize])
  // The "Your Text" box is the typing surface: the button focuses it, and the
  // first keystroke with nothing selected spawns the text on the shirt.
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const spawningRef = useRef(false)
  const pendingTextRef = useRef('')
  // "My Uploads" library — the caller's previously-uploaded images (server
  // returns them scoped to the Shopify customer, or the anonymous session
  // cookie). Files live in Cloudinary; these rows just index them.
  const [libraryUploads, setLibraryUploads] = useState<UploadItem[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  // Drives the save feedback only: logged-out customers get the restore link
  // surfaced (their only handle), logged-in ones just get "Saved ✓" since it's
  // in their account. The server derives the real owner — this is never trusted.
  const { loggedIn } = useCustomerSession()
  // "My Designs" library — saved designs, server-scoped to the Shopify customer
  // or the anonymous session cookie (same owner model as My Uploads).
  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([])
  const [designsLoading, setDesignsLoading] = useState(true)
  const [designsOpen, setDesignsOpen] = useState(false)
  // The design currently being edited (set on restore, and after a save) so
  // re-saving updates it in place instead of forking a copy.
  const currentDesignIdRef = useRef<string | null>(null)
  // Which template / print areas the current session resolved — stamped onto
  // the design_orders row at save time (Day 3 backend-completeness). The *Snap
  // refs hold the full area rows so print geometry survives later admin edits.
  const templateIdRef = useRef<string | null>(null)
  const printAreaFrontIdRef = useRef<string | null>(null)
  const printAreaBackIdRef = useRef<string | null>(null)
  const printAreaFrontSnapRef = useRef<any>(null)
  const printAreaBackSnapRef = useRef<any>(null)
  // 1b: replaces the window._printAreaData bridge — front/back print-area %s,
  // written at product load, read by the Front/Back toggle. In-component ref.
  const printAreaDataRef = useRef<{ front: PrintAreaPct | null; back: PrintAreaPct | null } | null>(null)
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
    // Remember which design we're editing so "Save design" updates it in place
    // rather than forking a copy. Safe for BOTH kinds of restore: the server
    // only updates in place if the caller owns a library entry for this id, so
    // an auto-draft (login snapshot) simply saves as a new design instead.
    currentDesignIdRef.current = restoreId

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
          const restoreSrc = imgs?.front || firstImageUrlRef.current
          if (restoreSrc && shirtImgRef.current) shirtImgRef.current.src = restoreSrc
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
    if (reflectingRef.current) return  // mirror-on-select must not reset scale
    // Update active object - re-wrap text at new font size
    const active = canvas.getActiveObject()
    if (active && (active.type === 'i-text' || active.type === 'textbox')) {
      // Re-wrap from _originalText (the clean source — only the customer's typed
      // Enter breaks), NOT active.text, which also carries the auto-inserted WRAP
      // newlines from when the text grew. reWrapText preserves every \n as a
      // paragraph, so feeding it active.text promoted auto-wraps to permanent
      // breaks and the text never re-flowed to one line when shrunk. Mirrors the
      // style effect + fitAndConstrain (fixes one-way wrap, pre-existing Day 9.1).
      if (!(active as any)._originalText) {
        (active as any)._originalText = ((active as any).text || '').replace(/\n/g, ' ').trim()
      }
      const baseText = isUppercase
        ? (active as any)._originalText.toUpperCase()
        : (active as any)._originalText
      const { text: rewrapped, fontSize: newSize } = reWrapText(
        baseText, fontSize, selectedFont, isBold, isItalic, letterSpacing * 10
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
      // Constrain ONLY the text being resized. A size change moves just that
      // object, so re-clamping EVERY object was a pure side-effect — it nudged
      // unselected images underneath (uploads especially, placed larger than
      // clipart). Matches the style effect, which already constrains active-only.
      const bounds = getPrintAreaBounds()
      if (active && bounds) constrainObject(active, bounds)
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
          firstImageUrlRef.current = allImages[0]?.url || ''
          const colorNames = data.options?.find((o: any) => o.name === 'Color')?.values || []
          const imgMap = buildColorImageMap(allImages, colorNames)
          setColorImageMap(imgMap)
          // Real per-product sizes in Shopify's variant order — never a
          // hardcoded adult list. Preserve any quantities already picked
          // (draft restore) while dropping stale keys.
          const sizeValues: string[] = data.options?.find((o: any) => o.name === 'Size')?.values || []
          const resolvedSizes = sizeValues.length ? sizeValues : SIZES
          setProductSizes(resolvedSizes)
          setQuantities(prev => resolvedSizes.reduce(
            (acc: Record<string, number>, s: string) => ({ ...acc, [s]: prev[s] ?? 0 }), {}))
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
                .select('id, default_print_method, product_template_print_areas(*), product_template_colors(*)')
                .eq('shopify_product_id', data.id)
                .eq('is_active', true)
                .maybeSingle()

              // Template garment colors (independent of print areas) → swatch
              // rendering + selected_color_hex capture.
              const tplColors = (tpl?.product_template_colors || []) as any[]
              if (tplColors.length) {
                const cmap: Record<string, { hex: string; swatch_image_url: string | null }> = {}
                tplColors.forEach((c: any) => { cmap[c.color_name] = { hex: c.hex, swatch_image_url: c.swatch_image_url } })
                setTemplateColors(cmap)
              }

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
                  // Containment transform now lives in ../lib/printAreaGeometry
                  // (shared + unit-tested at synthetic aspect ratios; pinned so
                  // the CanvasStage extraction can't silently shift it). Same
                  // math as before, verbatim.
                  const toPct = (a: any) =>
                    a ? toPctContain(a, natural.w, natural.h, 680, 850) : null
                  const frontArea = pickSide('front')
                  const backArea = pickSide('back')
                  const pa = { front: toPct(frontArea), back: toPct(backArea) }
                  if (pa.front || pa.back) {
                    printAreaDataRef.current = pa
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
                printAreaDataRef.current = pa
              } catch (e) { console.error('Print area parse error', e) }
            } else if (data.metafield?.value) {
              try {
                const pa = JSON.parse(data.metafield.value)
                setPrintArea(pa.front)
                printAreaDataRef.current = pa
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
            const loadSrc = imgs?.front || firstImageUrlRef.current
            if (loadSrc && shirtImgRef.current) shirtImgRef.current.src = loadSrc

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

  // D0 step 2: canvas CREATION + disposal now live in CanvasStage (it owns the
  // Fabric lifecycle). This runs as CanvasStage's onReady(canvas) callback —
  // every handler/control/geometry below is wired in the parent's scope exactly
  // as before, in the same create-then-attach order. 1b: the canvas is published
  // to fabricCanvasRef here (not the old window._fabricCanvas global), and the
  // align helper is now the component-scope alignObject() — no window bridges.
  const handleCanvasReady = (canvas: any) => {
      const getLiveBounds = () => {
        const canvasEl = canvasRef.current
        if (!canvasEl) return null
        const overlay = document.querySelector('[data-print-area]') as HTMLElement
        if (!overlay) return null
        const canvasRect = canvasEl.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const scaleX = CANVAS_W  / canvasRect.width
        const scaleY = CANVAS_H / canvasRect.height
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

      // Rotation had NO constraint handler — a rotated object's swung-out corners
      // could leave the print area. constrainObject uses aCoords, so it already
      // handles rotated corners; just wire it up (best-effort: it repositions, it
      // can't shrink an object that's bigger than the box when tilted).
      canvas.on('object:rotating', (e: any) => {
        const obj = e.target
        if (!obj) return
        const bounds = getLiveBounds()
        if (!bounds) return
        constrainObject(obj, bounds)
      })

      // Track selected object text for font preview
      canvas.on('selection:created', (e: any) => {
        const obj = e.selected?.[0]
        if (obj) { lastActiveObjectRef.current = obj; _activeObj = obj }
        // A curve re-bake swaps the object under us — keep the refs, but don't
        // re-run the tab-switch/reflect on every frame (that was the "shake").
        if (curveBakingRef.current) return
        if (obj) setActiveTab(sectionForObject(obj))
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox' || (obj as any)._isCurvedText)) {
          const raw = ((obj as any)._originalText || obj.text || '').replace(/\n/g, ' ')
          setSelectedTextPreview(raw.trim())
          setSelectedObjectType('text')
          // The panel's "Your Text" box is bound to the selection — selecting
          // text on the shirt fills it in, ready to edit.
          setTextInput(raw)
          // ...and the knobs mirror the object (font/size/color/spacing/etc.),
          // so the panel reflects THIS text — guarded from the push effects.
          reflectTextObject(obj)
        } else if (obj) {
          setSelectedObjectType((obj as any)._isSvg ? 'svg' : 'image')
          if ((obj as any)._isSvg && (obj as any)._currentColor) {
            setSelectedSvgColor((obj as any)._currentColor)
          } else if ((obj as any)._isSvg) {
            setSelectedSvgColor('')
          }
          setSelectedTextPreview('')
          setTextInput('')
        }
      })
      canvas.on('selection:updated', (e: any) => {
        const obj = e.selected?.[0]
        if (obj) { lastActiveObjectRef.current = obj; _activeObj = obj }
        // A curve re-bake swaps the object under us — keep the refs, but don't
        // re-run the tab-switch/reflect on every frame (that was the "shake").
        if (curveBakingRef.current) return
        if (obj) setActiveTab(sectionForObject(obj))
        if (obj && (obj.type === 'i-text' || obj.type === 'textbox' || (obj as any)._isCurvedText)) {
          const raw = ((obj as any)._originalText || obj.text || '').replace(/\n/g, ' ')
          setSelectedTextPreview(raw.trim())
          setSelectedObjectType('text')
          // The panel's "Your Text" box is bound to the selection — selecting
          // text on the shirt fills it in, ready to edit.
          setTextInput(raw)
          // ...and the knobs mirror the object (font/size/color/spacing/etc.),
          // so the panel reflects THIS text — guarded from the push effects.
          reflectTextObject(obj)
        } else if (obj) {
          setSelectedObjectType((obj as any)._isSvg ? 'svg' : 'image')
          if ((obj as any)._isSvg && (obj as any)._currentColor) {
            setSelectedSvgColor((obj as any)._currentColor)
          } else if ((obj as any)._isSvg) {
            setSelectedSvgColor('')
          }
          setSelectedTextPreview('')
          setTextInput('')
        } else {
          setSelectedTextPreview('')
          setSelectedObjectType(null)
          setTextInput('')
        }
      })
      canvas.on('selection:cleared', () => {
        setSelectedTextPreview('')
        setSelectedObjectType(null)
        setTextInput('')
      })

      // ONE editing surface: the box.
      //
      // Fabric's in-canvas edit mode is deliberately off (editable:false below).
      // With intentional breaks preserved, obj.text mixes two kinds of newline —
      // the customer's and the wrapper's — and they're the same character, so
      // _originalText could not be re-derived from it without flattening the
      // customer's stacked lines. Double-click therefore selects the text and
      // hands the caret to the box, which is the single source of truth.
      canvas.on('mouse:dblclick', (e: any) => {
        const obj = e.target
        if (!obj || (obj.type !== 'i-text' && obj.type !== 'textbox')) return
        textInputRef.current?.focus()
        textInputRef.current?.select()
      })

      // Fires once a drag/scale/rotate COMPLETES, and only from real user
      // interaction — programmatic obj.set() (fitAndConstrain, restore) doesn't
      // trigger it, which is exactly why it's safe as a dirty signal.
      // Catch-all re-clamp when any interaction settles (move/scale/rotate), so
      // nothing is left sitting outside the print area at release.
      canvas.on('object:modified', (e: any) => {
        const obj = e?.target
        const bounds = getLiveBounds()
        if (obj && bounds) constrainObject(obj, bounds)
        markDirty()
      })

      // Keep the reactive object count in sync so the blank-shirt empty-state
      // overlay appears when the current side is empty and hides the moment
      // anything is placed (also fires during side-switch/restore rebuilds — the
      // count just reflects whatever's actually on the canvas).
      const syncObjectCount = () => setCanvasObjectCount(canvas.getObjects().length)
      canvas.on('object:added', syncObjectCount)
      canvas.on('object:removed', syncObjectCount)

      setFabricCanvas(canvas)
      fabricCanvasRef.current = canvas

      // (Order restore for the designId "Edit design" flow is handled by the
      // consolidated effect above, which restores BOTH front and back.)

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
          // Text is edited in the box, never in-canvas — see the mouse:dblclick
          // handler. Applied here so RESTORED designs (loaded from canvas JSON,
          // where editable defaults back to true) are covered too, not just the
          // ones we create.
          if (e.target && (e.target.type === 'i-text' || e.target.type === 'textbox')) {
            e.target.editable = false
          }
        })
        canvas.on('selection:created', (e: any) => {
          if (e.selected) e.selected.forEach(applyControls)
        })
        // Apply to existing objects
        canvas.getObjects().forEach(applyControls)
        canvas.renderAll()
      })
      setIsLoading(false)
  }

  // 1b: replaces the window._alignObject bridge — align the active object to the
  // print-area edges/center. Reads the live canvas from fabricCanvasRef.
  const alignObject = (fn: string) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject() || _activeObj || lastActiveObjectRef.current || canvas.getObjects()[canvas.getObjects().length - 1]
    if (!active) return
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return
    const cr = canvasEl.getBoundingClientRect()
    const or = overlay.getBoundingClientRect()
    const sx = CANVAS_W / cr.width
    const sy = CANVAS_H / cr.height
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

  const handleColorSelect = useCallback((color: string) => {
    markDirty()
    setSelectedColor(color)
    setShirtHex(COLOR_HEX_MAP[color] || '#888')
    setQuantities((productSizes.length ? productSizes : SIZES).reduce((acc, s) => ({ ...acc, [s]: 0 }), {}))
    const imgs = getColorImages(color, colorImageMap)
    const url = (shirtView === 'back'
      ? (imgs?.back || imgs?.front)
      : (imgs?.front || imgs?.back)) || firstImageUrlRef.current
    if (url && shirtImgRef.current) shirtImgRef.current.src = url
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

  // Re-render curved text when curveAmount (or the baked font/size/color) changes.
  // Bug #1 fix: this used to rasterize + remove/add + re-select on EVERY slider
  // tick, so dragging shook the tool. Now the bake is COALESCED to one per
  // animation frame (still live — the curve follows the slider ~60fps), a token
  // DROPS any bake superseded before its async decode finishes, the old object is
  // kept until the new one is ready then SWAPPED (no remove→gap→add flash), and
  // the re-bake's re-selection is flagged so the panel doesn't reflect every frame.
  useEffect(() => {
    if (reflectingRef.current) return  // mirror-on-select sets curve=0; don't re-curve
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    // Snapshot the values THIS bake uses (closure over this render's state).
    const cAmount = curveAmount, cFont = selectedFont, cSize = fontSize
    const cFill = textColor, cBold = isBold, cItalic = isItalic

    const doBake = async () => {
      const active = canvas.getActiveObject()
      if (!active) return
      const rawText = (active as any)._originalText || (active as any).text || ''
      if (!rawText) return
      // The arc renderer lays every character along a single arc, so a newline
      // would collapse — the slider is disabled for multi-line text; this backstops.
      if (cAmount !== 0 && rawText.includes('\n')) return

      const spawnX = (active as any).left || 280
      const spawnY = (active as any).top || 350
      const myToken = ++curveTokenRef.current
      const old = active

      // Swap `old` → `next` in place: add the new object, re-select it (flagged so
      // the panel doesn't churn), THEN remove the old one — no empty frame.
      const swap = (next: any) => {
        curveBakingRef.current = true
        canvas.add(next)
        canvas.setActiveObject(next)
        curveBakingRef.current = false
        if (old && old !== next) canvas.remove(old)
        lastActiveObjectRef.current = next
        _activeObj = next
        canvas.renderAll()
      }

      // curve === 0 → back to an editable IText
      if (cAmount === 0) {
        if (!(active as any)._isCurvedText) return  // already plain — nothing to do
        const { IText } = await import('fabric')
        if (myToken !== curveTokenRef.current) return  // superseded by a newer bake
        const { text: wrappedText, fontSize: autoFontSize } = reWrapText(rawText, cSize, cFont, cBold, cItalic, letterSpacing * 10)
        const textObj = new IText(wrappedText, {
          left: spawnX, top: spawnY,
          fontFamily: cFont, fontSize: autoFontSize,
          fill: cFill, fontWeight: cBold ? 'bold' : 'normal',
          fontStyle: cItalic ? 'italic' : 'normal',
          textAlign: textAlign, charSpacing: letterSpacing * 10,
          originX: 'center', originY: 'center',
        })
        ;(textObj as any)._originalText = rawText
        swap(textObj)
        return
      }

      // curve !== 0 → bake the arc to an image
      const direction = cAmount > 0 ? 'curve-up' : 'curve-down'
      const absAmount = Math.abs(cAmount)
      const fSize = cSize
      const radius = Math.max(fSize * 1.5, 800 - absAmount * 7.5)

      const tmpCanvas = document.createElement('canvas')
      const tmpCtx = tmpCanvas.getContext('2d')!
      tmpCtx.font = `${cItalic ? 'italic' : 'normal'} ${cBold ? 'bold' : 'normal'} ${fSize}px ${cFont}`
      const chars = rawText.split('')
      const charWidths = chars.map((ch: string) => tmpCtx.measureText(ch).width)
      const totalWidth = charWidths.reduce((a: number, b: number) => a + b, 0)
      const padding = fSize * 2
      const size = Math.min(Math.max(totalWidth + padding * 2, radius * 2 + padding * 2), 1200)
      const offCanvas = document.createElement('canvas')
      offCanvas.width = size
      offCanvas.height = size
      const ctx = offCanvas.getContext('2d')!
      ctx.font = `${cItalic ? 'italic' : 'normal'} ${cBold ? 'bold' : 'normal'} ${fSize}px ${cFont}`
      ctx.fillStyle = cFill
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const totalAngle = totalWidth / radius
      const isDown = direction === 'curve-down'
      const orderedChars = isDown ? [...chars].reverse() : chars
      const orderedWidths = isDown ? [...charWidths].reverse() : charWidths
      let currentAngle = -totalAngle / 2
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

      const { FabricImage } = await import('fabric')
      const img: any = await FabricImage.fromURL(dataUrl)
      if (myToken !== curveTokenRef.current) return  // superseded while decoding
      img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
      img._isCurvedText = true
      img._originalText = rawText
      // Stamp the exact params this was baked with, so selecting the curved text
      // reflects them and adjusting re-bakes from its OWN font/size/color.
      img._curveAmount = cAmount
      img._curveFontFamily = cFont
      img._curveFontSize = fSize
      img._curveFill = cFill
      img._curveBold = cBold
      img._curveItalic = cItalic
      // Keep the re-baked curved text inside the print area (Issue-2).
      const cbounds = getPrintAreaBounds()
      if (cbounds) {
        const maxScale = Math.min(
          (cbounds.right - cbounds.left) / (img.width || 1),
          (cbounds.bottom - cbounds.top) / (img.height || 1),
        )
        if (maxScale < 1) img.set({ scaleX: maxScale, scaleY: maxScale })
        constrainObject(img, cbounds)
      }
      swap(img)
    }

    // Coalesce to one bake per animation frame; the cleanup cancels a not-yet-fired
    // frame, so rapid slider ticks collapse to a single bake of the latest value.
    if (curveRafRef.current != null) cancelAnimationFrame(curveRafRef.current)
    curveRafRef.current = requestAnimationFrame(() => { curveRafRef.current = null; void doBake() })
    return () => {
      if (curveRafRef.current != null) { cancelAnimationFrame(curveRafRef.current); curveRafRef.current = null }
    }
  }, [curveAmount, fontSize, selectedFont, textColor, isBold, isItalic])

  // Clears the pull-on-select guard. Declared AFTER every push/dirty/curve
  // effect above, so on the batched mirror commit it flushes last — the guarded
  // effects have already bailed, and the next real knob change (guard false)
  // pushes normally. Runs every commit; idempotent when the guard is already off.
  useEffect(() => { reflectingRef.current = false })

  const reWrapText = (text: string, targetFontSize: number, fontFamily: string, bold: boolean, italic: boolean, charSpacing: number = 0): { text: string; fontSize: number } => {
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return { text, fontSize: targetFontSize }

    const canvasRect = canvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const scaleX = CANVAS_W / canvasRect.width
    const maxWidth = overlayRect.width * scaleX * 0.92
    const maxHeight = overlayRect.height * (CANVAS_H / canvasRect.height) * 0.92

    const tmpCanvas = document.createElement('canvas')
    const tmpCtx = tmpCanvas.getContext('2d')!
    const fontWeight = bold ? 'bold' : 'normal'
    const fontStyle = italic ? 'italic' : 'normal'

    const measureWidth = (t: string, size: number) => {
      tmpCtx.font = `${fontStyle} ${fontWeight} ${size}px ${fontFamily}`
      // Add letter-spacing (Fabric charSpacing is 1/1000 em) so the shrink-to-fit
      // shrinks the font for wide spacing instead of letting it overflow the box.
      return tmpCtx.measureText(t).width + (charSpacing / 1000) * size * t.length
    }

    // A newline here is an INTENTIONAL break the customer typed (Enter in the
    // box) and must survive: each break starts a paragraph, and each paragraph
    // wraps within itself. Collapsing them was the old behaviour, and it's why
    // Enter used to lay a doomed break that vanished on the next re-wrap.
    const paragraphs = text.split('\n').map(p => p.replace(/\s+/g, ' ').trim())
    const words = paragraphs.flatMap(p => p.split(' ')).filter(Boolean)
    let autoFontSize = targetFontSize

    // Reduce font size until the longest single word fits (a word can't break)
    while (autoFontSize > 8 && words.length) {
      const longestWord = words.reduce((a, b) =>
        measureWidth(a, autoFontSize) > measureWidth(b, autoFontSize) ? a : b
      )
      if (measureWidth(longestWord, autoFontSize) <= maxWidth) break
      autoFontSize -= 1
    }

    // Build wrapped lines, paragraph by paragraph
    const buildLines = (size: number) => {
      const lines: string[] = []
      paragraphs.forEach(paragraph => {
        if (!paragraph) {
          lines.push('') // a deliberate blank line
          return
        }
        let currentLine = ''
        paragraph.split(' ').forEach(word => {
          const testLine = currentLine ? currentLine + ' ' + word : word
          if (measureWidth(testLine, size) > maxWidth && currentLine) {
            lines.push(currentLine)
            currentLine = word
          } else {
            currentLine = testLine
          }
        })
        if (currentLine) lines.push(currentLine)
      })
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

  const getPrintAreaBounds = () => {
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    if (!overlay || !canvasEl) return null
    const canvasRect = canvasEl.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()
    const scaleX = CANVAS_W / canvasRect.width
    const scaleY = CANVAS_H / canvasRect.height
    return {
      left: (overlayRect.left - canvasRect.left) * scaleX,
      top: (overlayRect.top - canvasRect.top) * scaleY,
      right: (overlayRect.right - canvasRect.left) * scaleX,
      bottom: (overlayRect.bottom - canvasRect.top) * scaleY,
    }
  }

  // THE single enforcement point for the print-area contract.
  //
  // Two separate mechanisms keep text in the box and both are required:
  // reWrapText controls SIZE (font size + line breaks), constrainObject controls
  // POSITION. Doing only the first is how text ended up correctly sized but
  // still sticking out of the box — every text mutation goes through here.
  const fitAndConstrain = (obj: any) => {
    const canvas = fabricCanvasRef.current
    if (!canvas || !obj) return
    // Legacy/restored objects predate _originalText: seed it flattened, since
    // they were authored before intentional breaks existed.
    if (obj._originalText == null) {
      obj._originalText = (obj.text || '').replace(/\n/g, ' ').trim()
    }
    // NOTE: no newline-stripping here — _originalText now carries the
    // customer's intentional breaks and reWrapText preserves them.
    const raw: string = obj._originalText || ''
    if (raw.trim()) {
      const base = isUppercaseRef.current ? raw.toUpperCase() : raw
      const { text, fontSize: fitted } = reWrapText(
        base,
        fontSizeRef.current,
        obj.fontFamily,
        obj.fontWeight === 'bold',
        obj.fontStyle === 'italic',
        obj.charSpacing || 0,
      )
      obj.set({ text, fontSize: fitted })
    }
    const bounds = getPrintAreaBounds()
    if (bounds) constrainObject(obj, bounds)
    canvas.renderAll()
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


  // The box is bound to the selected text, so its value tells us whether the
  // design is stacked — which the curve renderer can't represent.
  const textIsMultiline = textInput.includes('\n')

  // "+ Add another text" — deselect and hand the caret to the box, so the next
  // keystroke spawns a fresh text. The box is the typing surface, so starting a
  // new element is just "clear the box and focus it"; no empty object is created
  // until there's actually something to show.
  const startNewText = () => {
    const canvas = fabricCanvasRef.current
    if (canvas) {
      canvas.discardActiveObject()
      canvas.renderAll()
    }
    setTextInput('')
    setSelectedTextPreview('')
    setSelectedObjectType(null)
    textInputRef.current?.focus()
  }

  // Rail = "add a NEW one." Selection drives the panel while something's picked,
  // so switching rail category means "leave edit mode": drop the selection
  // (selection:cleared resets selectedObjectType → the panel shows the chosen
  // category's ADD surface) and set the tab.
  const handleSelectTab = (tab: 'text' | 'upload' | 'clipart') => {
    const canvas = fabricCanvasRef.current
    if (canvas) {
      canvas.discardActiveObject()
      canvas.renderAll()
    }
    setActiveTab(tab)
  }

  // Mobile sheet tab tap: switch tool AND expand the sheet from peek → half so
  // the tool's controls come into view.
  const sheetSelectTab = (tab: 'text' | 'upload' | 'clipart') => {
    handleSelectTab(tab)
    setSheetSnap(s => (s === 'peek' ? 'half' : s))
  }

  // Put a new text on the shirt from the box's first keystroke. Deliberately
  // does NOT enter Fabric's edit mode: the caret stays in the box, which is what
  // makes live wrapping safe — we can re-wrap obj.text freely because we never
  // touch the DOM input's caret.
  const spawnTextFromBox = async () => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const { IText } = await import('fabric')
    // Typed and deleted again before the import resolved — spawning now would
    // leave an invisible empty object that still counts as design content.
    if (!pendingTextRef.current.trim()) return
    const bounds = getPrintAreaBounds()
    const textObj = new IText('', {
      left: bounds ? (bounds.left + bounds.right) / 2 : 280,
      top: bounds ? (bounds.top + bounds.bottom) / 2 : 378,
      fontFamily: selectedFont,
      fontSize,
      fill: textColor,
      fontWeight: isBold ? 'bold' : 'normal',
      fontStyle: isItalic ? 'italic' : 'normal',
      textAlign: textAlign,
      charSpacing: letterSpacing * 10,
      angle: textDirection === 'vertical' ? 90 : 0,
      originX: 'center',
      originY: 'center',
      // Edited via the box only — see the mouse:dblclick handler.
      editable: false,
    })
    // Use the latest keystroke, not the one that triggered the spawn — the
    // dynamic import gives fast typists time to get ahead of us.
    ;(textObj as any)._originalText = pendingTextRef.current
    canvas.add(textObj)
    canvas.setActiveObject(textObj)
    lastActiveObjectRef.current = textObj
    _activeObj = textObj
    setSelectedObjectType('text')
    fitAndConstrain(textObj)
  }

  // The "Your Text" box drives the shirt. With a text selected it edits it; with
  // nothing selected the first keystroke spawns one. Either way the shirt
  // updates on every keystroke — wrapped and inside the print area.
  const handleTextInputChange = (value: string) => {
    markDirty()
    setTextInput(value)
    setSelectedTextPreview(value.trim())
    pendingTextRef.current = value

    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject() as any
    const isText = active && (active.type === 'i-text' || active.type === 'textbox')

    if (!isText) {
      // Nothing selected: first real keystroke puts a text on the shirt. The
      // guard stops fast typing from racing the async import into duplicates.
      if (!value.trim() || spawningRef.current) return
      spawningRef.current = true
      void spawnTextFromBox().finally(() => { spawningRef.current = false })
      return
    }

    active._originalText = value
    // Emptying the box removes the text — the box IS the text, so leaving the
    // old words on the shirt (or an invisible empty object that still counts as
    // design content) would both be wrong. Typing again spawns a fresh one.
    if (!value.trim()) {
      canvas.remove(active)
      setSelectedObjectType(null)
      setSelectedTextPreview('')
      canvas.renderAll()
      return
    }
    fitAndConstrain(active)
  }

  // Load the caller's "My Uploads" library once on mount. Server scopes it to
  // the Shopify customer (if logged in) or the anonymous session cookie.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/uploads', { credentials: 'include', cache: 'no-store' })
        if (res.ok) {
          const { uploads } = await res.json()
          if (active) setLibraryUploads(Array.isArray(uploads) ? uploads : [])
        }
      } catch { /* leave empty */ }
      if (active) setLibraryLoading(false)
    })()
    return () => { active = false }
  }, [])

  // Load the caller's saved designs. Server scopes to the Shopify customer (if
  // logged in) or the anonymous session cookie.
  const loadSavedDesigns = async () => {
    try {
      const res = await fetch('/api/designs', { credentials: 'include', cache: 'no-store' })
      if (res.ok) {
        const { designs } = await res.json()
        setSavedDesigns(Array.isArray(designs) ? designs : [])
      }
    } catch { /* leave as-is */ }
    setDesignsLoading(false)
  }

  useEffect(() => { void loadSavedDesigns() }, [])

  // Remove a library entry. The design_orders row is left intact, so any
  // restore link the customer already shared keeps working.
  const deleteSavedDesign = async (savedId: string) => {
    setSavedDesigns(prev => prev.filter(d => d.savedId !== savedId))
    try {
      await fetch(`/api/designs?id=${encodeURIComponent(savedId)}`, { method: 'DELETE', credentials: 'include' })
    } catch { /* already removed from UI */ }
  }

  // Open a saved design: a full navigation to the designer with ?restore=, which
  // is the same path the post-login rehydrate uses.
  const openSavedDesign = (d: SavedDesign) => {
    // Carry the SAME context every other entry path carries. This originally
    // passed only product_id + restore, so a design opened from the drawer lost
    // its title and variant — which is why those rows saved with an empty
    // product_title and showed blank in the admin order view.
    const params = new URLSearchParams()
    if (d.productId) params.set('product_id', d.productId)
    if (d.variantId) params.set('variant_id', d.variantId)
    if (d.productTitle) params.set('title', d.productTitle)
    if (d.unitPrice != null) params.set('price', String(Math.round(d.unitPrice * 100)))
    params.set('restore', d.designId)
    window.location.href = `/designer?${params.toString()}`
  }

  // Record a Cloudinary asset in the caller's library and prepend it to the
  // strip. Non-blocking on failure (the image still placed on the canvas).
  const persistUploadToLibrary = async (info: {
    url: string; publicId?: string; fileName: string; fileType?: string
    source: string; width?: number; height?: number
    originalUrl?: string; originalFormat?: string
  }) => {
    try {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cloudinaryUrl: info.url,
          cloudinaryPublicId: info.publicId,
          fileName: info.fileName,
          fileType: info.fileType,
          source: info.source,
          width: info.width,
          height: info.height,
          originalUrl: info.originalUrl,
          originalFormat: info.originalFormat,
        }),
      })
      if (!res.ok) return
      const { upload } = await res.json()
      if (upload) setLibraryUploads(prev => [upload, ...prev.filter(u => u.id !== upload.id)])
    } catch { /* non-blocking */ }
  }

  // Remove a library entry only — never the Cloudinary file (a saved design may
  // reference it). Optimistic; the server delete is scoped to the caller.
  const deleteLibraryUpload = async (id: string) => {
    setLibraryUploads(prev => prev.filter(u => u.id !== id))
    try {
      await fetch(`/api/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
    } catch { /* already removed from UI */ }
  }

  // Re-add a library image to the canvas (and track it for the order so a reused
  // upload is included at cart-add, same as a fresh upload).
  const pickLibraryUpload = async (item: UploadItem) => {
    if (!fabricCanvas) return
    try {
      const { FabricImage } = await import('fabric')
      const img = await FabricImage.fromURL(item.url, { crossOrigin: 'anonymous' })
      ;(img as any)._uploadSrc = item.url
      await placeImageOnCanvas(img, fabricCanvas)
      markDirty()
      uploadedFilesRef.current = [
        ...uploadedFilesRef.current,
        { name: item.fileName, url: item.url, type: item.fileType || 'image' },
      ]
    } catch {
      alert('Could not add that image. Please try again.')
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !fabricCanvas) return
    markDirty()

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
        // Cloudinary KEEPS the original: secure_url points at the uploaded .ai
        // itself, and /f_png/ is a delivery-time transformation, not a
        // destructive conversion. Record the original so the print shop can get
        // the vector — previously we kept only the PNG rendition.
        const originalUrl: string = data.secure_url
        const pngUrl = originalUrl.replace('/upload/', '/upload/f_png/')
        const { FabricImage } = await import('fabric')
        const img = await FabricImage.fromURL(pngUrl, { crossOrigin: 'anonymous' })
        ;(img as any)._uploadSrc = pngUrl
        await placeImageOnCanvas(img, fabricCanvas)
        // Index the converted PNG in My Uploads (Cloudinary already hosts it).
        void persistUploadToLibrary({ url: pngUrl, publicId: data.public_id, fileName: file.name, fileType: 'image/png', source: 'converted', width: data.width, height: data.height, originalUrl, originalFormat: ext })
        // Track for the order. These types were never tracked at all, so a fresh
        // AI/PSD/EPS upload never reached design_orders.uploaded_files — the print
        // shop only saw it if the customer happened to re-add it from My Uploads.
        uploadedFilesRef.current = [...uploadedFilesRef.current, {
          name: file.name, url: pngUrl, type: 'image/png', originalUrl, originalFormat: ext,
        }]
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
        // Persist the rasterized page for display, AND the source PDF as the
        // original. Unlike AI/PSD/EPS (which Cloudinary receives whole), the PDF
        // is rasterized locally by PDF.js — so its original was never uploaded
        // anywhere and was genuinely discarded. This uploads it.
        const [uploaded, original] = await Promise.all([
          uploadToCloudinary(dataUrl),
          uploadToCloudinary(file),
        ])
        if (uploaded) {
          ;(img as any)._uploadSrc = uploaded.url
          void persistUploadToLibrary({
            url: uploaded.url, publicId: uploaded.publicId, fileName: file.name,
            fileType: 'image/png', source: 'pdf', width: uploaded.width, height: uploaded.height,
            originalUrl: original?.url, originalFormat: 'pdf',
          })
          uploadedFilesRef.current = [...uploadedFilesRef.current, {
            name: file.name, url: uploaded.url, type: 'image/png',
            originalUrl: original?.url, originalFormat: 'pdf',
          }]
        }
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
      // Track uploaded file for order storage. Provisionally the data URL —
      // swapped for the Cloudinary URL below once it resolves.
      const entry = { name: file.name, url: dataUrl, type: file.type || ext }
      uploadedFilesRef.current = [...uploadedFilesRef.current, entry]
      ;(img as any)._uploadSrc = dataUrl
      // Persist to My Uploads via Cloudinary (background; needs Cloudinary).
      const uploaded = await uploadToCloudinary(file)
      if (uploaded) {
        // Carry the CLOUDINARY url into the order, not the data URL. The data
        // URL would be re-uploaded to the customer-uploads bucket at cart-add;
        // Cloudinary already has the identical bytes, so this gives every upload
        // type one URL grammar and one place to live.
        entry.url = uploaded.url
        ;(img as any)._uploadSrc = uploaded.url
        void persistUploadToLibrary({ url: uploaded.url, publicId: uploaded.publicId, fileName: file.name, fileType: file.type || ext, source: 'raster', width: uploaded.width, height: uploaded.height })
      }
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
      const scaleX = CANVAS_W / canvasRect.width
      const scaleY = CANVAS_H / canvasRect.height
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
  const exportCanvasPNG = async (canvas: any, shirtSrc: string | null | undefined): Promise<Blob | null> => {
    return new Promise(async resolve => {
      try {
        const composite = document.createElement('canvas')
        composite.width = 680
        composite.height = 850
        const ctx = composite.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 680, 850)
        // Load the (per-side) shirt image via server proxy to avoid CORS.
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
      // Sync the live canvas into the ref for the CURRENT view first, so both
      // refs hold the true front/back content regardless of which side is
      // showing. Previously the live canvas was always exported as "front", so
      // a design created on the back view was saved into the front slot (and
      // the back slot left null) — a fulfillment data-integrity bug.
      const liveObjects = canvas.getObjects().map((o: any) => o)
      if (shirtView === 'front') frontObjectsRef.current = liveObjects
      else backObjectsRef.current = liveObjects

      // Export one side from its ref: PNG + SVG + JSON, each written to that
      // side's slot. Empty side -> all nulls (no downstream line/preview).
      const exportSide = async (objs: any[], name: string, shirtSrc: string | undefined) => {
        if (!objs.length) return { png: null as string | null, svg: null as string | null, json: null as string | null }
        canvas.clear()
        objs.forEach((o: any) => canvas.add(o))
        canvas.renderAll()
        const pngBlob = await exportCanvasPNG(canvas, shirtSrc)
        const svgBlob = exportCanvasSVG(canvas)
        // MUST be toObject(props), not toJSON(props). Fabric's own source says
        // it plainly: "JSON does not support additional properties because
        // toJSON has its own signature" — toJSON() is the standard JS
        // serialization hook, so its signature is fixed and it SILENTLY IGNORES
        // the argument. Passing CANVAS_CUSTOM_PROPS to toJSON looked like a fix
        // and did nothing: custom props were dropped, so an "Edit design"
        // restore (which reads canvas_json_*) lost _originalText, and lost the
        // _uploadSrc stamps too — taking the print shop's files with it.
        // Proof: the draft path's toObject(CUSTOM_PROPS) kept stamps on the same
        // objects, minutes apart, in the same session.
        const json = JSON.stringify(canvas.toObject(CANVAS_CUSTOM_PROPS))
        const [png, svg] = await Promise.all([
          pngBlob ? uploadToStorage(pngBlob, `${orderId}/${name}.png`, 'design-exports') : null,
          svgBlob ? uploadToStorage(svgBlob, `${orderId}/${name}.svg`, 'design-exports') : null,
        ])
        return { png, svg, json }
      }

      // Each side composites onto ITS OWN shirt image (front vs back mockup for
      // the selected color) — previously both used the live view's shirt, so a
      // back-designed order showed both previews on the back-of-shirt image.
      const sideImgs = getColorImages(selectedColor, colorImageMap)
      const frontShirt = sideImgs?.front || firstImageUrlRef.current || undefined
      const backShirt = sideImgs?.back || firstImageUrlRef.current || undefined
      const front = await exportSide(frontObjectsRef.current, 'front', frontShirt)
      const back = await exportSide(backObjectsRef.current, 'back', backShirt)

      // Restore the live view onto the canvas.
      canvas.clear()
      liveObjects.forEach((o: any) => canvas.add(o))
      canvas.renderAll()

      const pngFrontUrl = front.png, svgFrontUrl = front.svg
      const pngBackUrl = back.png, svgBackUrl = back.svg

      // 4. Upload the customer's files — but ONLY the ones actually PLACED in
      // the final design. uploadedFilesRef is append-only per session, so
      // "uploaded five logos, used one" would otherwise hand the print shop all
      // five. The library keeps everything (correct); the ORDER carries what's on
      // the garment.
      //
      // Matched on the _uploadSrc stamp rather than obj.src: Fabric rewrites src
      // (data URL for rasters, the f_png rendition for converted files), so
      // string-matching the stored URL would be exactly the kind of over-fitting
      // that broke the image-filename parser. An explicit stamp is exact.
      // Deleting an image removes its object, so it drops out for free.
      const usedSrcs = new Set<string>()
      ;[...frontObjectsRef.current, ...backObjectsRef.current].forEach((o: any) => {
        if (o?._uploadSrc) usedSrcs.add(o._uploadSrc)
      })
      const seenUrls = new Set<string>()
      const filtered = uploadedFilesRef.current.filter(f => {
        if (!usedSrcs.has(f.url) || seenUrls.has(f.url)) return false
        seenUrls.add(f.url) // same image on both sides -> one entry
        return true
      })
      // Fail SAFE. If we hold uploads but found no stamps at all, something
      // upstream lost them (e.g. a design saved by an older build, whose canvas
      // JSON predates the toObject fix). Handing the print shop EXTRA files is
      // the old behaviour; handing them NOTHING is a silent fulfilment failure —
      // which is exactly what shipped and had to be caught in testing.
      const usedFiles =
        usedSrcs.size === 0 && uploadedFilesRef.current.length > 0
          ? uploadedFilesRef.current
          : filtered

      const uploadedFileUrls = await Promise.all(
        usedFiles.map(async (f, idx) => {
          // originalUrl rides along so the admin/print shop can reach the vector
          // rather than only the flattened rendition.
          const extra = f.originalUrl
            ? { originalUrl: f.originalUrl, originalFormat: f.originalFormat }
            : {}
          if (!f.url.startsWith('data:')) return { name: f.name, url: f.url, type: f.type, ...extra }
          const blob = await fetch(f.url).then(r => r.blob())
          const url = await uploadToStorage(blob, `${orderId}/uploads/${idx}_${f.name}`, 'customer-uploads')
          return { name: f.name, url: url || f.url, type: f.type, ...extra }
        })
      )

      // 5. Save to design_orders via the server route (service role) — the
      // public RLS insert policy is gone (BLOCKER-1 lockdown). The route
      // forces status='draft' and rejects order-linkage/PII columns, so this
      // payload can't be abused to forge anything beyond a draft.
      const saveRes = await fetch('/api/design-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        id: orderId,
        shopify_product_id: product?.id || '',
        shopify_variant_id: selectedVariant?.id || '',
        product_title: productTitle,
        selected_color: selectedColor,
        // Garment hex for the print shop. Only stamp a real mapped hex — an
        // unmapped color stays null rather than the misleading #888 fallback.
        // TODO: source hex from designer_colors instead of the hardcoded
        // COLOR_HEX_MAP (see CLAUDE.md).
        selected_color_hex: templateColors[selectedColor]?.hex ?? COLOR_HEX_MAP[selectedColor] ?? null,
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
        canvas_json_front: front.json,
        canvas_json_back: back.json,
        uploaded_files: uploadedFileUrls,
        quantities,
        // Real sizes available for the selected color, in Shopify variant order.
        available_sizes: (productSizes.length ? productSizes : SIZES).filter(s => isSizeAvailable(s)),
        unit_price: unitPrice,
        print_charge: printCharge,
        // Per-side split (Day 4). Null when that side has no content, so the
        // order page / fulfillment can tell "designed but $0" from "not designed".
        print_charge_front: frontHasContent ? frontCharge : null,
        print_charge_back: backHasContent ? backCharge : null,
        price_per_item: pricePerItem,
        total_qty: totalQty,
        total_price: parseFloat(total),
        }),
      })

      if (!saveRes.ok) {
        console.error('Order save error:', saveRes.status, await saveRes.text().catch(() => ''))
        return null
      }
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
    markDirty()
    if (!fabricCanvas) return
    const active = fabricCanvas.getActiveObject()
    if (active) { fabricCanvas.remove(active); fabricCanvas.renderAll() }
  }

  // ── CanvasStage parity harness hook (DEV-ONLY, ?parity=1) ──────────────────
  // READ-ONLY instrumentation for the extraction gate. Exposes the canvas + the
  // load-bearing geometry/export functions on window.__parity so the
  // golden-master fixtures can characterize them identically before/after the
  // CanvasStage extraction. Purely ADDITIVE and parity-NEUTRAL — it only
  // EXPOSES existing functions, changes no geometry — and it MOVES WITH
  // CanvasStage during extraction (same hook drives both main and the branch).
  // Gated on ?parity=1 so it never touches normal use. Driven from the browser
  // console: `await window.__parity.run()` (downloads parity-<product>-<side>.json).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('parity') !== '1') return
    const api = {
      get canvas() { return fabricCanvasRef.current },
      CANVAS_CUSTOM_PROPS,
      constrainObject,
      getPrintAreaBounds,
      reWrapText,
      exportCanvasSVG,
      exportCanvasPNG,
      get shirtImg() { return shirtImgRef.current },
      container: { W: 680, H: 850 },
      currentSide: () => shirtView,
      productLabel: (productTitle || 'product').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    }
    ;(window as unknown as { __parity: unknown }).__parity = {
      ...api,
      run: async () => {
        const { runParityFixtures } = await import('../lib/parityFixtures')
        return runParityFixtures(api as unknown as import('../lib/parityFixtures').ParityApi)
      },
    }
  })

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

  // Blank-shirt empty state: on-garment CTAs when the CURRENT side has nothing on
  // it; the "Let's build it" greeting ONLY on a fully-blank design (front, back
  // also empty) — a first-impression thing, so once you've started (or you're on
  // the back) it's CTAs only. Add Text focuses the box (the discoverability fix).
  const emptyState = canvasObjectCount === 0 ? {
    showGreeting: shirtView === 'front' && backObjectsRef.current.length === 0,
    // On mobile the tools live in the sheet, so each CTA also opens it to half.
    onAddText: () => { setActiveTab('text'); if (isMobile) setSheetSnap('half'); setTimeout(() => textInputRef.current?.focus(), 0) },
    onUpload: () => { setActiveTab('upload'); if (isMobile) setSheetSnap('half') },
    onAddArt: () => { setActiveTab('clipart'); if (isMobile) setSheetSnap('half') },
  } : null
  // Per-side surcharge. designer_pricing.sides is a SIDE IDENTITY (1 = Front,
  // 2 = Back), NOT a count — each side is charged independently. Sum the price
  // for each side that has content rather than looking up by the number of
  // sides (the old `printPricing[sidesCount]` charged a 2-sided design the
  // single Back-row price, e.g. $12 instead of $12 + $12 = $24).
  const frontCharge = frontHasContent ? (printPricing[1] ?? 12) : 0
  const backCharge = backHasContent ? (printPricing[2] ?? 12) : 0
  const printCharge = frontCharge + backCharge
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
    const CUSTOM_PROPS = CANVAS_CUSTOM_PROPS
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

  // Composite a thumbnail for the My Designs tile. Prefers the front side, and
  // falls back to the back for a back-only design so the tile is never blank.
  // Mutates the live canvas to render the chosen side, then puts it back —
  // same dance saveDesignAndAddToCart does.
  const exportFrontThumbnail = async (thumbId: string): Promise<string | null> => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return null
    try {
      const liveObjects = canvas.getObjects().map((o: any) => o)
      if (shirtView === 'front') frontObjectsRef.current = liveObjects
      else backObjectsRef.current = liveObjects

      const useFront = frontObjectsRef.current.length > 0
      const objs = useFront ? frontObjectsRef.current : backObjectsRef.current
      if (!objs.length) return null

      const imgs = getColorImages(selectedColor, colorImageMap)
      const shirtSrc = (useFront ? imgs?.front : imgs?.back) || firstImageUrlRef.current || undefined

      canvas.clear()
      objs.forEach((o: any) => canvas.add(o))
      canvas.renderAll()
      const blob = await exportCanvasPNG(canvas, shirtSrc)

      canvas.clear()
      liveObjects.forEach((o: any) => canvas.add(o))
      canvas.renderAll()

      if (!blob) return null
      return await uploadToStorage(blob, `saved/${thumbId}.png`, 'design-exports')
    } catch (err) {
      console.error('[designer] thumbnail export failed:', err)
      return null
    }
  }

  // "Save design" — snapshot the canvas into the customer's library. Returns the
  // restore link so the control can surface it to a logged-out customer (their
  // only handle on the design until they log in and it's adopted).
  const handleSaveDesign = async (): Promise<{ restoreUrl: string } | null> => {
    const state = snapshotDesignState()
    if (!state) {
      alert('Please add a design before saving. Add text, clipart, or upload an image.')
      return null
    }
    const pngFront = await exportFrontThumbnail(crypto.randomUUID())
    try {
      const res = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ designId: currentDesignIdRef.current, state, pngFront }),
      })
      if (!res.ok) return null
      const { designId } = await res.json()
      if (!designId) return null
      currentDesignIdRef.current = designId
      setIsDirty(false)

      // Point the URL at the saved design so a refresh (or the browser Back
      // button) lands back on it rather than an empty canvas.
      const params = new URLSearchParams(window.location.search)
      params.set('restore', designId)
      const path = `${window.location.pathname}?${params.toString()}`
      window.history.replaceState({}, '', path)

      void loadSavedDesigns()
      return { restoreUrl: `${window.location.origin}${path}` }
    } catch (err) {
      console.error('[designer] save design failed:', err)
      return null
    }
  }

  // D0 SelectionPanel extraction, Stage 1: two inline canvas snippets lifted
  // VERBATIM out of the panel JSX into named handlers, so Stage 2 can move the
  // panel as a dumb view. handleTextAlign = the A9 align button's inline onClick;
  // handleClipartSelect = ClipartPanel's inline onSelect closure. Logic unchanged.
  const handleTextAlign = (align: 'left' | 'center' | 'right') => {
    setTextAlign(align)
    const canvas = fabricCanvasRef.current
    const obj = canvas?.getActiveObject()
    if (obj && obj.type === 'textbox') {
      obj.set('textAlign', align)
      canvas.renderAll()
    }
  }

  const handleClipartSelect = (url: string, fileType: string) => {
    if (!fabricCanvas) return
    markDirty()
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    let spawnX = 280, spawnY = 378
    if (overlay && canvasEl) {
      const canvasRect = canvasEl.getBoundingClientRect()
      const overlayRect = overlay.getBoundingClientRect()
      const scaleX = CANVAS_W / canvasRect.width
      const scaleY = CANVAS_H / canvasRect.height
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
          const scaleX = CANVAS_W / canvasRect.width
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
  }

  // D0 ActionBar extraction: the header's Next Step onClick, lifted VERBATIM into
  // a named handler (cross-side validation + save/add-to-cart + the browser-Back
  // replaceState rehydration + navigate) and passed to <ActionBar> as onNextStep.
  // The `data-cart-btn` global query still finds the button inside ActionBar.
  // Behavior-neutral move; the isSubmitting-prop cleanup is deferred to Phase 2.
  const handleNextStep = async () => {
    const canvas = fabricCanvasRef.current
    // Cross-side check: allow continuing if EITHER side has content, not just the
    // currently-visible canvas (a back-only design viewed from the empty front
    // should still pass).
    if (!canvas || (!frontHasContent && !backHasContent)) {
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
      // Stamp the designer's history entry so browser-Back from the order page
      // rehydrates the FULL design: design_id restores the canvas (front + back),
      // and the CURRENT variant_id/quantity restore the last color/size/quantity —
      // not the stale params from the first Design-Now click. (Then Back once more
      // → product page cleanly.)
      try {
        const backUrl = new URL(window.location.href)
        backUrl.searchParams.set('design_id', result.orderId)
        const vId = selectedVariant?.id?.split('/').pop()
        if (vId) backUrl.searchParams.set('variant_id', vId)
        if (totalQty > 0) backUrl.searchParams.set('quantity', String(totalQty))
        window.history.replaceState({}, '', backUrl.pathname + backUrl.search)
      } catch { /* ignore */ }
      window.location.href = `/order?design_id=${result.orderId}`
    } else {
      alert('Error saving design. Please try again.')
    }
  }

  // The tool panel body — defined ONCE and rendered in exactly one place at a
  // time (desktop left aside OR mobile sheet), so its textInputRef binds to a
  // single textarea (two live copies would fight over the ref).
  const selectionPanel = (
    <SelectionPanel
      activeTab={activeTab}
      dbColors={dbColors}
      deleteSelected={deleteSelected}
      text={{ textInput, textInputRef, handleTextInputChange, selectedObjectType, startNewText, dbFonts, fonts, selectedFont, setSelectedFont, selectedTextPreview, fontSize, setFontSize, letterSpacing, setLetterSpacing, textColor, setTextColor, textDirection, setTextDirection, curveAmount, setCurveAmount, textIsMultiline, textAlign, handleTextAlign, isBold, setIsBold, isItalic, setIsItalic, isUppercase, setIsUppercase }}
      upload={{ handleImageUpload, libraryUploads, libraryLoading, pickLibraryUpload, deleteLibraryUpload }}
      clipart={{ printMethod, handleClipartSelect, recolorSvg, setSelectedSvgColor, selectedSvgColor }}
    />
  )

  // Root is a fixed, app-like viewport: no page scroll / pull-to-refresh on
  // mobile, so touch gestures reach the canvas + sheet instead of the browser.
  // Desktop keeps h-screen exactly (lg:h-screen) — parity-safe; the overflow /
  // overscroll locks are no-ops on desktop. dvh accounts for the mobile URL bar.
  return (
    <div className="flex flex-col h-dvh lg:h-screen overflow-hidden overscroll-none text-gray-900" style={{ fontFamily: 'DM Sans, sans-serif' }}>

      {/* Header — extracted to <ActionBar> (D0 restructure step 1a, move-not-
          rewrite). Phase 2: becomes the sealed "price + Save + Next" bottom bar
          + Build It → Order It → Pick Up/Ship stepper + folds in the price column. */}
      <ActionBar
        productTitle={productTitle}
        onSave={handleSaveDesign}
        loggedIn={loggedIn}
        dirty={isDirty}
        savedDesignsCount={savedDesigns.length}
        onOpenDesigns={() => setDesignsOpen(true)}
        onBeforeLogin={prepareLoginRedirect}
        onNextStep={handleNextStep}
        pricePerItem={pricePerItem}
      />

      {/* Progress strip under the top bar — Build It (here) → Order It → Pick Up/Ship.
          Hidden on mobile (the shirt needs the vertical space; Next Step in the
          condensed top bar keeps the journey clear). Desktop unchanged. */}
      <div className="hidden lg:block">
        <Stepper current={1} />
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left tool panel — DESKTOP only (mobile uses the bottom sheet below).
            Rendered conditionally (not CSS-hidden) so exactly one SelectionPanel
            is mounted → one textInputRef, one textarea. Desktop uses `flex`
            exactly as before → parity-safe. */}
        {!isMobile && (
          <aside className="w-[360px] bg-white border-r border-gray-200 flex overflow-hidden shrink-0">
            <Rail activeTab={activeTab} onSelectTab={handleSelectTab} />
            <div className="flex-1 min-w-0 overflow-y-auto pt-3">
              {selectionPanel}
            </div>
          </aside>
        )}

        {/* Canvas center */}
        <section ref={stageAreaRef} className="flex-1 flex flex-col items-center justify-center bg-gray-50 relative overflow-hidden touch-none">

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
                  alignObject(fn)
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
                const canvas = fabricCanvasRef.current
                if (!canvas) return
                canvas.clear()
                canvas.renderAll()
              }}
              className="px-2 py-1 rounded text-xs font-mono bg-gray-100 border border-gray-200 text-red-500 hover:border-red-700 hover:bg-red-900/20 transition-all">
              Clear All
            </button>
          </div>
          {/* Scale-to-fit wrapper (mobile only). Outer = the SCALED layout box so
            the shirt doesn't overflow; inner keeps the true 680×850 and is CSS
            transform-scaled. On desktop stageScale===1 → outer is 680×850, inner
            has NO transform → identical to rendering <CanvasStage> alone (the flex
            section centers a 680×850 box either way). Parity proves it. */}
        <div style={{ width: 680 * stageScale, height: 850 * stageScale }}>
          <div style={{ width: 680, height: 850, transformOrigin: 'top left', transform: stageScale !== 1 ? `scale(${stageScale})` : undefined }}>
            <CanvasStage canvasRef={canvasRef} shirtImgRef={shirtImgRef} printArea={printArea} onReady={handleCanvasReady} emptyState={emptyState} />
          </div>
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
                const frontSrc = imgs?.front || firstImageUrlRef.current
                if (frontSrc && shirtImgRef.current) shirtImgRef.current.src = frontSrc
                if (printAreaDataRef.current?.front) { setPrintArea(printAreaDataRef.current.front); window.dispatchEvent(new Event('printAreaChanged')) }
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
                  const backSrc = imgs?.back || firstImageUrlRef.current
                  if (backSrc && shirtImgRef.current) shirtImgRef.current.src = backSrc
                  if (printAreaDataRef.current?.back) { setPrintArea(printAreaDataRef.current.back); window.dispatchEvent(new Event('printAreaChanged')) }
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
        <aside className="w-64 bg-white border-l border-gray-200 hidden lg:flex lg:flex-col gap-4 p-4 overflow-y-auto shrink-0">
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
                      style={
                        templateColors[color]?.swatch_image_url
                          ? {
                              backgroundImage: `url(${templateColors[color]!.swatch_image_url})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              border: '1px solid #555',
                            }
                          : {
                              // Template hex first; COLOR_HEX_MAP fallback for non-templated products.
                              background: templateColors[color]?.hex || COLOR_HEX_MAP[color] || '#888',
                              border: ['White', 'Natural'].includes(color) ? '1px solid #555' : 'none',
                            }
                      }
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
          </div>
          {/* Price is folded into the top action bar now ("$X.XX each", neutral);
              the full Blank + Front/Back Print breakdown lives on the Order step,
              along with quantity + order total. */}
        </aside>
      </div>

      {/* Mobile tool sheet — brings the tools to the phone (peek/half/full).
          Mounted only on mobile, so it owns the single SelectionPanel. */}
      {isMobile && (
        <MobileToolSheet snap={sheetSnap} setSnap={setSheetSnap} activeTab={activeTab} onSelectTab={sheetSelectTab}>
          {selectionPanel}
        </MobileToolSheet>
      )}

      <MyDesignsDrawer
        open={designsOpen}
        designs={savedDesigns}
        loading={designsLoading}
        onClose={() => setDesignsOpen(false)}
        onOpenDesign={openSavedDesign}
        onDelete={deleteSavedDesign}
      />
    </div>
  )
}
