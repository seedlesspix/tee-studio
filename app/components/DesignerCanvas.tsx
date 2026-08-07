'use client'
// Module-level variable to persist active object across button clicks
let _activeObj: any = null
// Transient per-session id assigned to canvas objects for the Layers list (stable React keys +
// row→object lookup). NOT persisted (absent from CANVAS_CUSTOM_PROPS) — objects are re-ided on restore.
let _layerSeq = 0
const NN_ROW_ID = '__nn__' // the single collapsed "Names & Numbers" row's id

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import CanvasStage from './CanvasStage'
import { getProduct } from '../lib/shopify'
import { buildColorImageMap, getColorImages } from '../lib/productImages'
import { AUTODRAFT_KEY, buildEnvelope, parseEnvelope, shouldRestore } from '../lib/autodraft'
import { placedInches, lowResTier } from '../lib/lowRes'
import { maxScaleForRotation } from '../lib/rotationFit'
import NamesNumbersPanel from './NamesNumbersPanel'
import { type RosterEntry, type NnRole, NN_ROLE_PROP, entryHasContent, condensedScaleX, rosterShirtCount, rosterSizeQuantities, rosterValue, jerseyStackLayout } from '../lib/namesNumbers'
import { renderCurvedArc } from '../lib/curvedArc'
import { refitSide, rebakeCurveParams, type RefitBox, type CanvasObj } from '../lib/refitEngine'
import { boxFromSnapshot, isSnapshot, boxFromPct } from '../lib/boxSnapshot'

// Locked jersey placeholders can't be moved/resized/rotated by the customer (geometry is canonical;
// only font + color are theirs). These locks ENFORCE that on desktop AND mobile regardless of which
// control handles show; the control sets are separately trimmed to delete-only for a placeholder.
const NN_LOCK_PROPS = {
  lockMovementX: true, lockMovementY: true,
  lockScalingX: true, lockScalingY: true, lockRotation: true,
} as const

// Placeholders are single-line, all-caps/digits, display-only. Fabric IGNORES lineHeight for a
// single line's box height (calcTextHeight uses getHeightOfLineImpl for the last line, no lineHeight
// factor) — so the box is fontSize × _fontSizeMult (default 1.13) with a fat descender gap below the
// caps (_fontSizeFraction default 0.222). We tune BOTH: a small _fontSizeFraction keeps the BOTTOM
// tight (no empty band under the letters), while _fontSizeMult stays high enough that the ASCENT
// (=(1-frac)×mult ≈ 0.83) exceeds even tall-cap jersey fonts — otherwise their caps poke out the top
// of the box (and risk the print area). Ascent 0.83 covers ~any font; bottom stays hugged. NAME also
// sits with head room from the print-area top (STACK_Y_FRAC) so no font's caps can exceed the zone.
const NN_TEXT_METRICS = { _fontSizeMult: 0.88, _fontSizeFraction: 0.06 } as const
import { toPctContain, CANVAS_W, CANVAS_H, type PrintAreaPct } from '../lib/printAreaGeometry'
import ActionBar from './ActionBar'
import Stepper from './Stepper'
import Rail from './Rail'
import SelectionPanel from './SelectionPanel'
import LayersPanel, { type LayerKind, type LayerRow } from './LayersPanel'
import MobileToolBand from './MobileToolBand'
import MobileTextBand from './MobileTextBand'
import MobileUploadBand from './MobileUploadBand'
import MobileArtBand from './MobileArtBand'
import { type UploadItem } from './MyUploadsPanel'
import {
  AlignLeft, AlignCenter, AlignRight,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  Undo2, Redo2,
} from 'lucide-react'
import MyDesignsDrawer, { type SavedDesign } from './MyDesignsDrawer'
import ProductPickerModal, { type TemplateProduct } from './ProductPickerModal'
import { useCustomerSession } from '../hooks/useCustomerSession'
import { knockoutColorGlobal, knockoutWhiteFromEdges, elementToImageData, imageDataToPngDataUrl, sampleColorAt, cropToDataUrl } from '../lib/imageEdit'

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

// Max upload size. Cloudinary's unsigned /image/upload rejects files over the plan's
// image cap (free tier = 10 MB), which used to fail silently — worst for PDFs, where the
// preview was kept but the original was dropped with no error. We now validate client-
// side FIRST for a clear rejection + a "just email us" pressure valve.
// ← ONE NUMBER TO CHANGE: bump to 20 when the account upgrades to the paid tier at launch.
const MAX_UPLOAD_MB = 10
// Upload-box guidance (customer-facing). EDITABLE STRING — destined for the labels-as-data /
// language editor (not built yet); until it exists, tune the wording here. The size interpolates
// MAX_UPLOAD_MB so it ALWAYS matches the real limit (shows 10 MB now, 20 MB after the launch bump).
const UPLOAD_GUIDANCE = `Vector or high-resolution artwork (300 DPI or more) will look best. Max size ${MAX_UPLOAD_MB} MB.`
// Low-resolution WARNING (never blocks — a quality nudge, unlike the hard MAX_UPLOAD_MB cap). Two tiers,
// two tailored messages (Denise 2026-08-06). The tier MATH + thresholds live in ../lib/lowRes (shared
// with the OrderInfo.txt bench flag so they can't disagree); only these EDITABLE customer STRINGS live
// here (destined for the labels-as-data / language editor). Applies to RASTER uploads only (SVG clipart
// is vector → never low-res). See project_lowres_warning.
const LOWRES_MSG_SMALL = '⚠ This image is low-resolution and may print blurry. For the sharpest print use 300 DPI or higher — or email us your original file.'
const LOWRES_MSG_PLACED = '⚠ Low resolution at this size — may print blurry. Try making it smaller, use a higher-resolution image, or email us your original.'
// Customer-facing method labels (Denise: the site says "Print", never "Screen Print"). Editable /
// labels-as-data-ready; the internal keys (screen_print/embroidery) are load-bearing and never change.
const METHOD_LABELS: Record<string, string> = { screen_print: 'Print', embroidery: 'Embroidery' }
const methodLabel = (m: string) => METHOD_LABELS[m] || m
// Rail tools that don't apply to embroidery — hidden entirely in embroidery mode (Denise). Upload =
// raster (can't be embroidered); names = the print cut-file N&N (embroidered N&N needs stitch files,
// a future thread). Keep Text (embroidery fonts) · Thread colors · Art (embroidery clipart) · Curve.
const HIDDEN_FOR_EMBROIDERY = ['upload', 'names']
// Customer-facing address for the "email us the big file" valve. Shown in the reject
// message so an oversize file still reaches the shop.
const SUPPORT_EMAIL = 'orders@tshirtdeli.com' // TODO(Denise): confirm the real address

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
  // D2 Design Portability: when true, the designId design was made on a DIFFERENT product — re-fit its
  // artwork onto THIS product's print box on open (proportional scale-to-fit + re-center) instead of a
  // plain edit-restore. Set by the "Use on another product" flow.
  refit?: boolean
  // D2 color reconcile: the color to prefer on load (?color=), carried from the saved design so a port
  // lands on the SAME color when the target offers it (exact name match), else the target's first color.
  // Only used when no variant_id pins a color.
  initialColor?: string
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
  '_curveAmount', '_curveFontFamily', '_curveFontSize', '_curveFill', '_curveBold', '_curveItalic', '_curveCharSpacing',
  '_isVectorUpload', // an uploaded SVG (vector) — excluded from the low-res warning (client + bench)
  '_nnRole', // Names & Numbers placeholder role ('name'|'number') — the substitution + cut-file split key
  // A placed DESIGN (decal): the admin-assigned number + its name, frozen onto the object so the order
  // can record which decals were used (sell-through). Survives serialization via this allowlist.
  '_decalNumber', '_decalName',
  // Which print methods a placed art supports — a method switch keeps art valid in the new method
  // (dual-method clipart survives Print↔Embroidery) instead of removing everything.
  '_supportedMethods']

// Fallback size list ONLY — real sizes come per-product from the Shopify Size
// option (see productSizes). Used when a product exposes no Size option.
const SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL']

// buildColorImageMap / getColorImages now live in ../lib/productImages (shared
// with the template admin) and match by color-name-contains rather than a rigid
// filename parse.

// Constrain a Fabric object to stay within the print area bounds
function constrainObject(obj: any, bounds: { left: number; top: number; right: number; bottom: number }) {
  // Use aCoords for accurate canvas-relative bounding box. Take min/max across ALL FOUR corners — for a
  // ROTATED object any corner can be the extreme on a given axis, so the old two-corners-per-edge form
  // (min(tl,bl) etc., correct only when axis-aligned) computed a too-small box and a rotated object
  // could be dragged out of the print area. (Pre-existing since the initial commit.)
  obj.setCoords()
  const coords = obj.aCoords
  if (!coords) return

  const xs = [coords.tl.x, coords.tr.x, coords.bl.x, coords.br.x]
  const ys = [coords.tl.y, coords.tr.y, coords.bl.y, coords.br.y]
  const objLeft   = Math.min(...xs)
  const objRight  = Math.max(...xs)
  const objTop    = Math.min(...ys)
  const objBottom = Math.max(...ys)

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
  productId, variantId, productTitle, productPrice, designId = '', restoreId = '', initialQuantity = '', refit = false, initialColor = ''
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
  const [activeTab, setActiveTab] = useState<'text' | 'upload' | 'clipart' | 'style' | 'names' | 'layers'>('text')
  // Names & Numbers roster (Phase 1: component state + auto-draft; DB persistence = Phase 2 migration).
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [nnFields, setNnFields] = useState<{ name: boolean; number: boolean; title: boolean }>({ name: false, number: false, title: false })
  const [selectedNnRole, setSelectedNnRole] = useState<'name' | 'number' | 'title' | null>(null) // which placeholder is selected (drives in-panel styling)
  // Live roster preview: substitutes one entry onto the placeholders so the customer sees a real
  // shirt cycle through the list. TRANSIENT — never persisted. nnPreviewRef mirrors the index so
  // the auto-draft writer / snapshot / side-swap can synchronously tell "we're mid-preview, restore
  // the sample first" without waiting for a re-render. nnPreviewSavedRef holds each placeholder's
  // sample text + base scaleX to restore on exit.
  const [nnPreviewIndex, setNnPreviewIndex] = useState<number | null>(null)
  const nnPreviewRef = useRef<number | null>(null)
  const nnPreviewSavedRef = useRef<Map<any, { text: string; scaleX: number }>>(new Map())
  const [textInput, setTextInput] = useState('')
  const [selectedFont, setSelectedFont] = useState('Arial Black')
  const [textColor, setTextColor] = useState('#ffffff')
  const [fontSize, setFontSize] = useState(36)
  const [printMethod, setPrintMethod] = useState<string>('')
  // Embroidery mode (2026-08-06): a product's template can support MULTIPLE print methods (e.g. a hat =
  // print OR embroidery). supportedMethods drives the in-designer Print/Embroidery toggle; a single
  // supported method locks with no toggle. printMethod is the active one. The template is the source of
  // truth (default_print_method); the legacy Shopify metafield is a fallback for non-templated products.
  const [supportedMethods, setSupportedMethods] = useState<string[]>([])
  // Per-product Names & Numbers gate (2026-08-07): a template can turn OFF N&N for products it doesn't
  // belong on (accessories, etc.). Default true (non-templated + un-flagged products keep N&N).
  const [namesNumbersEnabled, setNamesNumbersEnabled] = useState(true)
  // Cached so a method toggle can re-pick this product's per-method print area without re-fetching.
  const loadedTemplateRef = useRef<any>(null)
  const mockupNaturalRef = useRef<{ w: number; h: number } | null>(null)
  // Set when a switch TO embroidery is confirmed: existing text is reset to the default embroidery font
  // + thread color once that config finishes loading (it loads async after setPrintMethod). See the
  // conversion effect near fetchDesignerConfig.
  const pendingEmbConvertRef = useRef(false)
  // True once the customer has used the method toggle, so the (async) product-load resolution can't
  // clobber their choice if they toggle during the load window.
  const userToggledMethodRef = useRef(false)
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center')
  const [selectedSvgColor, setSelectedSvgColor] = useState<string>('#000000')
  const [printPricing, setPrintPricing] = useState<Record<number, number>>({1: 12, 2: 20})
  const [dbFonts, setDbFonts] = useState<{ label: string; value: string }[]>([])
  const [dbColors, setDbColors] = useState<{ label: string; hex: string }[]>([])
  // The method dbFonts/dbColors were loaded FOR. Both methods have non-empty sets, so "is the embroidery
  // palette loaded yet?" can't be answered by length — the warn+convert restyle must wait until this
  // equals the target method, or it would restyle text to the STALE (print) palette then lock itself out.
  const [configMethod, setConfigMethod] = useState('')
  // Bumped once the product's template + mockup size are cached, so the print-area effect re-picks the
  // area on template-load (not just on method change) — needed when the resolved method equals the
  // initial one (setPrintMethod is then a no-op and wouldn't otherwise fire the effect).
  const [templateReadyTick, setTemplateReadyTick] = useState(0)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.16) // Fabric IText default; the Line Spacing slider drives this (multi-line text)
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUppercase, setIsUppercase] = useState(false)
  const [textShadow, setTextShadow] = useState(false)
  const [textOutline, setTextOutline] = useState(false)
  const [textDirection, setTextDirection] = useState<'horizontal' | 'vertical' | 'curve-up' | 'curve-down'>('horizontal')
  const [curveAmount, setCurveAmount] = useState(0)
  const [selectedTextPreview, setSelectedTextPreview] = useState<string>('')
  const [selectedObjectType, setSelectedObjectType] = useState<'text' | 'image' | 'svg' | null>(null)
  // Low-resolution warning for the SELECTED raster upload (null = fine / not an upload). Recomputed on
  // select + live while scaling — a bigger placement lowers effective DPI. Never blocks. See the
  // LOWRES_* constants + lowResMessageFor.
  const [lowResWarning, setLowResWarning] = useState<string | null>(null)
  // Upload-image editing (Phase 5): eyedropper mode for Remove-a-Color, its tolerance, a busy
  // flag so the tool buttons disable while a pixel op + re-upload runs, a LIVE-PREVIEW state
  // (pick a color -> preview while dragging tolerance -> Apply/Cancel), and a tick to re-evaluate
  // the Undo/Redo enabled state (edit history lives on the Fabric object, not in React state).
  const [eyedropperActive, setEyedropperActive] = useState(false)
  const [removeColorTol, setRemoveColorTol] = useState(30)
  const [imageEditBusy, setImageEditBusy] = useState(false)
  const [colorPreview, setColorPreview] = useState(false)
  const colorPreviewRef = useRef<{ obj: any; original: ImageData; originalSrc: string; pickedColor: { r: number; g: number; b: number } } | null>(null)
  const [editHistTick, setEditHistTick] = useState(0)
  // Manual drag-crop: a Fabric Rect overlay + 4 dimming scrims + the image it's cropping.
  const [cropMode, setCropMode] = useState(false)
  const cropRectRef = useRef<{ rect: any; img: any; scrims: any[]; sync: () => void } | null>(null)
  // Reactive count of objects on the CURRENT side's canvas — drives the blank-shirt
  // empty-state overlay (greeting + on-garment CTAs). Updated on object:added/removed.
  const [canvasObjectCount, setCanvasObjectCount] = useState(0)
  // Layers list nudge: a pure reorder (bringObjectForward/sendObjectBackwards) changes neither the
  // object count nor fires add/removed, so bump this to force the Layers panel to re-read getObjects().
  const [layersTick, setLayersTick] = useState(0)

  // ── Mobile (BLOCKER-2, canvas-scaling pass) ──────────────────────────────────
  const stageAreaRef = useRef<HTMLElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(false)
  // Live mirror of isMobile for callbacks captured once at canvas-init (the pre-existing
  // applyControls closure) that can't see React state updates.
  const isMobileRef = useRef(false)
  const [stageScale, setStageScale] = useState(1)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const update = () => { isMobileRef.current = mq.matches; setIsMobile(mq.matches) }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // iOS/WebKit only honours a fixed app viewport when the DOCUMENT itself is
  // locked — overflow:hidden on a child div does NOT stop html/body from panning,
  // which was letting the page drift horizontally and rubber-band under the
  // sheet's drag (three symptoms, one cause: the page ate the touch gestures).
  // position:fixed on body is the proven iOS lock. Applied via JS ONLY while the
  // designer is mounted AND on mobile → reverted on unmount/desktop, so no other
  // page and no desktop layout is affected (isMobile is false on desktop).
  useEffect(() => {
    if (!isMobile) return
    const html = document.documentElement
    const body = document.body
    html.classList.add('designer-touch-lock')
    body.classList.add('designer-touch-lock')
    return () => {
      html.classList.remove('designer-touch-lock')
      body.classList.remove('designer-touch-lock')
    }
  }, [isMobile])

  // Mobile tool band (rework, ImprintNext pattern): the tools live in an IN-FLOW
  // fixed-height band at the bottom of the mobile column (MobileToolBand), NOT an
  // overlay — so the shirt is never covered. On load the band is CLOSED (just the
  // icon strip; the shirt gets full space and the on-shirt "Let's build it" card is
  // the invitation). It OPENS when you tap a tool/CTA or select an object; switching
  // tools while open doesn't resize the shirt. Desktop: isMobile false → never mounts.
  const [bandOpen, setBandOpen] = useState(false)
  useEffect(() => {
    if (isMobile && selectedObjectType) setBandOpen(true)
  }, [selectedObjectType, isMobile])

  // Mobile keyboard: handled entirely by the BROWSER. No visualViewport JS, no height
  // locking — those were the bug. The mobile shell uses a STABLE height
  // (.designer-mobile-shell: -webkit-fill-available / 100vh — neither reacts to the
  // iOS keyboard, unlike 100dvh) and the page is a normal scrolling document, so iOS
  // scrolls the focused text box into view on its own. This is ImprintNext's approach,
  // verified against the same iPhone/Chrome. See the .designer-mobile-shell + touch-
  // lock notes in globals.css. Desktop is untouched (it keeps lg:h-screen).

  // Companion to the sticky top bar: iOS scrolls the document to lift the focused text
  // box above the keyboard, but doesn't reliably scroll back on dismiss — leaving the
  // shirt (and, without the sticky bar, the price/Next Step) scrolled out of view. When
  // focus leaves the text fields (keyboard closing), snap the page back to the top.
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return
    const onFocusOut = () => {
      setTimeout(() => {
        const ae = document.activeElement
        const typing = ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')
        if (!typing) window.scrollTo(0, 0)
      }, 80)
    }
    document.addEventListener('focusout', onFocusOut)
    return () => document.removeEventListener('focusout', onFocusOut)
  }, [isMobile])

  // Size the mobile shell to window.innerHeight (imperative, so no React lag). This is
  // the FIX for the top bar vanishing: -webkit-fill-available reported 767px on iOS
  // Chrome while the real window was 653px, so the column overflowed by 114px, became
  // scrollable, and the bar scrolled off. innerHeight is the true layout viewport, is
  // STABLE through the keyboard (verified: 653 with keyboard up AND down), and updates
  // on URL-bar show/hide + rotation via 'resize'. With the shell == the window, the
  // page fits (nothing to scroll) so the top bar can't leave.
  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return
    const apply = () => { if (shellRef.current) shellRef.current.style.height = window.innerHeight + 'px' }
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      const el = shellRef.current
      if (el) el.style.height = ''
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [isMobile])



  // Below the lg breakpoint (1024px — tablets are touch users too), CSS-scale the
  // fixed 680×850 stage to fit the canvas area. The COORDINATE space stays 680×850
  // (objects/bounds/saves unchanged); only the DISPLAY scales — Fabric's pointer
  // math and our bounds math both read getBoundingClientRect, which includes the
  // transform, so it's scale-invariant. On DESKTOP `isMobile` is false → stageScale
  // stays 1 → NO transform → layout byte-identical (proven by the parity harness).
  //
  // NOT pinned (Denise's call): the shirt fills the space it actually HAS — biggest
  // on load (band closed, ~width-bound), then re-fits smaller when the band opens.
  // Pinning to the band-open size made the load shirt tiny with a huge empty halo;
  // the moderate re-fit is the better trade. The ResizeObserver re-fits on any
  // section-height change (band open/close, contextual align strip).
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
  // Mirror of productSizes for effects that run without it in their dep list (the D2 refit branch reads
  // the target's sizes to reconcile carried quantities, and it can't take productSizes as a dep).
  const productSizesRef = useRef<string[]>([])

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
    setConfigMethod(method)
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

  // Restore canvas when designId provided. Plain EDIT restore (refit=false, "Edit design" flow) loads
  // the saved design as-is onto its own product. A D2 PORT (refit=true, "Use on another product")
  // RE-FITS the artwork onto THIS product's print box first (proportional scale-to-fit + re-center),
  // then re-wraps text / re-curves curved text; the N&N stack regenerates itself on the new box.
  // BLOCKER-1 lockdown: reads flow through the server route (service role); uploaded_files + roster +
  // print_area snapshots ride along (the port needs the frozen source box).
  useEffect(() => {
    if (!designId) return
    let attempts = 0
    const poll = setInterval(() => {
      attempts++
      const canvas = fabricCanvasRef.current
      // A port also needs THIS product's print box loaded — the target box for the re-fit.
      const targetReady = !refit || !!printAreaDataRef.current
      if (!canvas || !targetReady) { if (attempts > 40) clearInterval(poll); return }
      clearInterval(poll)
      fetch(`/api/design-orders/${designId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(async (payload) => {
          const data = payload?.order as {
            canvas_json_front: string | null
            canvas_json_back: string | null
            print_area_front: unknown
            print_area_back: unknown
            uploaded_files: unknown
            roster: unknown
            quantities: unknown
          } | undefined
          if (!data) return
          try {
            const { util } = await import('fabric')
            if (refit) {
              // D2 PORT — re-fit each side's JSON onto the target box (boxFromSnapshot = source, the
              // live product's box = target), then per-type follow-ups. Guard on across the transform
              // so the auto-draft writer never snapshots a mid-port state.
              isRestoringRef.current = true
              const refitJson = (cj: string | null, snap: unknown, pct: { xPct: number; yPct: number; widthPct: number; heightPct: number } | null | undefined): { objs: CanvasObj[]; scale: number } => {
                if (!cj) return { objs: [], scale: 1 }
                let parsed: { objects?: CanvasObj[] }
                try { parsed = JSON.parse(cj) } catch { return { objs: [], scale: 1 } }
                const objs = (parsed.objects ?? []) as CanvasObj[]
                if (!isSnapshot(snap) || !pct) return { objs, scale: 1 } // no reconstructable box → pass through
                const r = refitSide(objs, boxFromSnapshot(snap) as RefitBox, boxFromPct(pct) as RefitBox)
                return { objs: r.objects, scale: r.scale }
              }
              const front = refitJson(data.canvas_json_front, data.print_area_front, printAreaDataRef.current?.front)
              if (front.objs.length) {
                const fobjs = (await util.enlivenObjects(front.objs)) as any[]
                fobjs.forEach(o => canvas.add(o))
                await refitFollowups(fobjs, front.scale, getPrintAreaBounds())
                // N&N placeholders were passed through by refitSide (their geometry is regenerated,
                // never transformed). Re-lay the whole stack onto THIS product's print box now that
                // it's mounted — otherwise a ported jersey keeps its source-box position/size.
                applyStackLayout()
              }
              // Back geometry re-fits into the ref. Its DOM-coupled follow-ups (text re-wrap, curved
              // re-bake) still defer to the first flip to Back (they need the back overlay to measure).
              // But the N&N stack is PURE geometry — re-stack it EAGERLY onto the back box (derived from
              // printAreaDataRef %, no DOM) so a jersey ported with its stack on the back is correct even
              // if the customer saves/orders WITHOUT ever flipping to Back.
              const back = refitJson(data.canvas_json_back, data.print_area_back, printAreaDataRef.current?.back)
              const backObjs = back.objs.length ? (await util.enlivenObjects(back.objs)) as any[] : []
              backObjectsRef.current = backObjs
              const backPct = printAreaDataRef.current?.back
              const backPh = backObjs.filter((o: any) => o[NN_ROLE_PROP])
              if (backPh.length && backPct) {
                const bx = boxFromPct(backPct)
                layoutStackInto(backPh, { left: bx.left, top: bx.top, right: bx.left + bx.width, bottom: bx.top + bx.height })
              }
              backRefitPendingRef.current = backObjs.length ? back.scale : null
            } else {
              if (data.canvas_json_front) {
                const frontJson = JSON.parse(data.canvas_json_front)
                if (frontJson.objects?.length > 0) await canvas.loadFromJSON(frontJson)
              }
              if (data.canvas_json_back) {
                const backJson = JSON.parse(data.canvas_json_back)
                backObjectsRef.current = backJson.objects?.length ? (await util.enlivenObjects(backJson.objects)) as any[] : []
              }
            }
            if (Array.isArray(data.uploaded_files)) {
              uploadedFilesRef.current = data.uploaded_files as typeof uploadedFilesRef.current
            }
            // Names & Numbers: placeholders ride back on the canvas JSON, but the ROSTER (the player
            // list) is separate state — restore it or a 15-name list is silently lost.
            if (Array.isArray(data.roster)) setRoster(data.roster as RosterEntry[])
            // Size reconcile (D2 port/switch): the customer's picked quantities were for the SOURCE
            // garment. Carry the counts for sizes the TARGET also offers (exact name), drop the rest —
            // tee→triblend (both S–3XL) keeps the order; tee→onesie (adult→baby) resets to 0. Product-load
            // already zeroed quantities for the target's sizes; this overlays the surviving counts. N&N
            // orders derive quantities from the roster, so this is a no-op for them.
            if (refit && data.quantities && typeof data.quantities === 'object' && productSizesRef.current.length) {
              const carried = data.quantities as Record<string, number>
              setQuantities(productSizesRef.current.reduce(
                (acc: Record<string, number>, s: string) => ({ ...acc, [s]: Number(carried[s]) || 0 }), {}))
            }
            canvas.discardActiveObject()
            canvas.renderAll()
          } catch (e) { /* ignore restore errors */ }
          finally { if (refit) { isRestoringRef.current = false; markDirty() } }
        })
    }, 300)
    return () => clearInterval(poll)
  }, [designId, refit])

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
    // Locked jersey placeholder: apply ONLY font + color. Its size + position are canonical (set by
    // applyStackLayout) — never reWrap/resize/reposition it here. FONT is per-field; COLOR is UNIFIED
    // across the whole stack (Name/Number/Title share one ink — easier to print; Denise). So a color
    // pick lands on every placeholder, on this side or the other.
    if ((active as any)[NN_ROLE_PROP]) {
      (active as any).set({ fontFamily: selectedFont })
      ;[...(canvas.getObjects() as any[]), ...frontObjectsRef.current, ...backObjectsRef.current]
        .forEach((o: any) => { if (o && o[NN_ROLE_PROP]) o.set({ fill: textColor }) })
      canvas.renderAll()
      return
    }
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
        baseText, currentFontSize, selectedFont, isBold, isItalic, letterSpacing * 10, lineHeight
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
        lineHeight: lineHeight,
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
  }, [selectedFont, textColor, isBold, isItalic, isUppercase, textAlign, letterSpacing, lineHeight, textDirection, textOutline, curveAmount])

  // After a font CHANGE on the selected text, re-measure once the new font has actually loaded — the
  // synchronous set above may have measured a fallback (see ensureFontLoaded). Corrects the box and
  // re-constrains. Guarded against mirror-on-select so merely picking a text never reflows it.
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    const active = canvas?.getActiveObject() as any
    if (!canvas || !active || reflectingRef.current) return
    if (active.type !== 'i-text' && active.type !== 'textbox') return
    let cancelled = false
    ;(async () => {
      await ensureFontLoaded(selectedFont)
      if (cancelled || fabricCanvasRef.current !== canvas) return
      const { cache } = await import('fabric')
      cache.clearFontCache()
      if (!active.isEditing && typeof active.initDimensions === 'function') { active.initDimensions(); active.setCoords() }
      // Locked placeholder: never constrain/reposition it — re-assert the canonical stack instead
      // (its size + position are jersey-canonical, not the fit-to-box treatment).
      if (active[NN_ROLE_PROP]) { applyStackLayout() } else { const b = getPrintAreaBounds(); if (b) constrainObject(active, b) }
      canvas.requestRenderAll()
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFont])

  // Initial FOUT guard: the page's web fonts (Google display=swap + local @font-face) can still be
  // downloading when text is first created or a saved design is restored, so Fabric measures a
  // fallback and caches wrong widths. When the fonts finish, drop the stale widths and re-measure
  // everything (live canvas + both side refs) so every box matches its rendered glyphs. Re-runs as
  // objects change, since a newly-used local font can kick off a fresh load.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts?.ready) return
    let cancelled = false
    document.fonts.ready.then(async () => {
      if (cancelled) return
      const { cache } = await import('fabric')
      cache.clearFontCache()
      const canvas = fabricCanvasRef.current
      const fix = (objs: any[]) => objs.forEach(o => {
        if (!o || o.isEditing || typeof o.initDimensions !== 'function') return
        o.initDimensions(); o.setCoords?.()
      })
      if (canvas) fix(canvas.getObjects())
      fix(frontObjectsRef.current); fix(backObjectsRef.current)
      canvas?.requestRenderAll()
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fabricCanvas, canvasObjectCount])

  // Constrain all objects whenever fontSize changes (slider update)
  const fabricCanvasRef = useRef<any>(null)
  const lastActiveObjectRef = useRef<any>(null)
  // True only while a Layers row selects its object — tells the selection handlers to skip the
  // auto tab-switch so the customer stays on the Layers tab while reordering.
  const selectingFromLayersRef = useRef(false)
  const frontObjectsRef = useRef<any[]>([])
  const backObjectsRef = useRef<any[]>([])
  // D2 port: the back side re-fits its GEOMETRY into backObjectsRef up front, but the DOM-coupled
  // follow-ups (text re-wrap, curved re-bake, N&N re-stack) need the back print-area overlay mounted,
  // which only happens on the first flip to Back. This holds the back re-fit scale until then; a flip
  // to Back consumes it (see the lazy back-refit effect). null = nothing pending.
  const backRefitPendingRef = useRef<number | null>(null)

  // Mobile: a REDUCED control set (Instagram/Canva-style) instead of Fabric's 8 tiny
  // handles. THREE controls sitting OUTSIDE the selection box corners so they never
  // cover the object: delete (top-left), rotate (top-right), scale (bottom-right);
  // dragging the object body still moves it. Handles are drawn in CANVAS coords and the
  // mobile stage CSS-scales the 680×850 canvas DOWN by stageScale, so both the size AND
  // the outward offset are computed INVERSELY (~23px on screen) — which is why the
  // controls are rebuilt on every stage/object change (offset can't be static). Rotate/
  // scale reuse Fabric's DEFAULT handlers (properly anchored) via
  // createObjectDefaultControls(); delete reuses the app's deleteSelected. controls/
  // cornerSize are UI chrome — NOT serialized (toObject) and NOT in the PNG/SVG export —
  // so saves and parity hashes are unaffected. Desktop keeps Fabric's default 8 handles.
  const deleteSelectedRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!isMobile) return
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    let cancelled = false
    let cleanupAdded = () => {}
    ;(async () => {
      const { Control, controlsUtils } = await import('fabric')
      if (cancelled) return
      const d = controlsUtils.createObjectDefaultControls()
      const s = stageScale || 1
      const cornerSize = Math.round(23 / s)       // ~23px visual on screen
      const touchCornerSize = Math.round(30 / s)  // a little bigger hit area
      const borderScaleFactor = Math.max(2, Math.round(2 / s))
      const off = cornerSize * 0.75               // push the disc OUTSIDE the box corner
      // A control = white disc (soft shadow for contrast on any garment) + dark ring +
      // an icon. Icon size/stroke follow the object's (scaled) cornerSize.
      const discBg = (ctx: any, size: number) => {
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = size * 0.12
        ctx.beginPath()
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.shadowColor = 'transparent'
        ctx.lineWidth = Math.max(1.5, size * 0.08)
        ctx.strokeStyle = '#111827'
        ctx.stroke()
      }
      const glyphRender = (glyph: string, glyphScale = 0.5) =>
        (ctx: any, left: number, top: number, _o: any, obj: any) => {
          const size = obj.cornerSize || 23
          ctx.save(); ctx.translate(left, top); discBg(ctx, size)
          ctx.fillStyle = '#111827'
          ctx.font = `700 ${Math.round(size * glyphScale)}px sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(glyph, 0, size * 0.04)
          ctx.restore()
        }
      // Rotate: a DRAWN circular arrow (fills the disc — the ↻ glyph rendered too small).
      const rotateRender = (ctx: any, left: number, top: number, _o: any, obj: any) => {
        const size = obj.cornerSize || 23
        ctx.save(); ctx.translate(left, top); discBg(ctx, size)
        ctx.strokeStyle = '#111827'
        ctx.lineWidth = Math.max(2, size * 0.11)
        ctx.lineCap = 'round'
        const R = size * 0.29
        const end = Math.PI * 1.15
        ctx.beginPath()
        ctx.arc(0, 0, R, -Math.PI * 0.45, end)   // ~3/4 open circle
        ctx.stroke()
        const ex = Math.cos(end) * R, ey = Math.sin(end) * R   // arrowhead at the arc end
        const back = end + Math.PI / 2 + Math.PI               // opposite the clockwise tangent
        const h = size * 0.22
        ctx.beginPath()
        ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(back - 0.5) * h, ey + Math.sin(back - 0.5) * h)
        ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(back + 0.5) * h, ey + Math.sin(back + 0.5) * h)
        ctx.stroke()
        ctx.restore()
      }
      const reuse = (base: any, x: number, y: number, ox: number, oy: number, render: any, cursor: string) =>
        new Control({
          x, y, offsetX: ox, offsetY: oy, cursorStyle: cursor,
          actionHandler: base?.actionHandler,
          cursorStyleHandler: base?.cursorStyleHandler,
          actionName: base?.actionName,
          render,
        })
      const controls = {
        del: new Control({
          x: -0.5, y: -0.5, offsetX: -off, offsetY: -off, cursorStyle: 'pointer',
          mouseUpHandler: (_e: any, transform: any) => {
            const t = transform?.target
            if (t?.canvas) t.canvas.setActiveObject(t)
            deleteSelectedRef.current()
            return true
          },
          render: glyphRender('✕'),
        }),
        rot: reuse(d.mtr, 0.5, -0.5, off, -off, rotateRender, 'crosshair'),
        scale: reuse(d.br, 0.5, 0.5, off, off, glyphRender('◢'), 'nwse-resize'),
      }
      const applyTo = (obj: any) => {
        if (obj._isCropRect) return // the crop frame owns its own edge-only handles — never disc/delete it
        // Locked jersey placeholder: DELETE disc only — no move/resize/rotate (locks enforce it too).
        obj.controls = obj[NN_ROLE_PROP] ? { del: controls.del } : controls
        obj.set({ cornerSize, touchCornerSize, transparentCorners: false, borderColor: '#111827', borderScaleFactor })
        obj.setCoords?.()
      }
      canvas.getObjects().forEach(applyTo)
      canvas.requestRenderAll()
      // Also re-assert on every add (created / restored / re-added), since the pre-
      // existing applyControls now no-ops on mobile — otherwise a re-added object would
      // fall back to Fabric's default handles.
      const onAdded = (e: any) => { if (e?.target) { applyTo(e.target); canvas.requestRenderAll() } }
      canvas.on('object:added', onAdded)
      cleanupAdded = () => canvas.off('object:added', onAdded)
    })()
    return () => { cancelled = true; cleanupAdded() }
  }, [isMobile, stageScale, canvasObjectCount])
  // `url` is the DISPLAY rendition (what's on the canvas). `originalUrl` is the
  // file the customer actually uploaded — set only when they differ, i.e. when we
  // converted (AI/PSD/EPS/PDF). The print shop needs the original, not the PNG.
  const uploadedFilesRef = useRef<
    { name: string; url: string; type: string; originalUrl?: string; originalFormat?: string; edited?: boolean }[]
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
  // Current side, mirrored to a ref: the low-res check reads it from canvas handlers that are
  // registered ONCE at mount (onReady), so the `shirtView` STATE would be frozen at 'front' there —
  // the ref stays live so the back side's own print-area inches are used (not the front's).
  const shirtViewRef = useRef(shirtView)
  useEffect(() => { shirtViewRef.current = shirtView }, [shirtView])

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
  // Set to a curved-text object while it's being SCALE-dragged (object:scaling), consumed on
  // object:modified to re-bake it crisp. A bare scaleX≠1 test can't stand in for "was just resized":
  // bakeCurvedArc fit-clamps oversized arcs to scale<1 and that scale PERSISTS, so a plain move/rotate
  // of a clamped/restored curved text would otherwise spuriously re-bake. This flag fires only on a real
  // scale gesture (move→object:moving, rotate→object:rotating never set it).
  const curvedScaleGestureRef = useRef<any>(null)

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
      setLetterSpacing(Math.round((obj._curveCharSpacing || 0) / 10))
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
    setLineHeight(typeof obj.lineHeight === 'number' ? obj.lineHeight : 1.16)
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
  const sectionForObject = (obj: any): 'text' | 'upload' | 'clipart' | 'names' => {
    // Placeholders stay in the Names & Numbers panel (styled there), never the generic text-edit flow.
    if (obj?.[NN_ROLE_PROP]) return 'names' // any placeholder (name/number/title)
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
  // Auto-draft: a debounced sessionStorage snapshot so an accidental refresh / pull-to-refresh
  // doesn't lose UNSAVED work. markDirty (fired on every design change) schedules a write; the
  // writer itself is kept current via a ref (see the effect after snapshotDesignState).
  const autodraftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autodraftWriteRef = useRef<() => void>(() => {})
  const isRestoringRef = useRef(false) // true while applyDesignState runs — suppresses the writer so a mid-restore (transiently empty) canvas can't wipe the snapshot
  const scheduleAutodraft = useCallback(() => {
    if (typeof window === 'undefined') return
    if (autodraftTimer.current) clearTimeout(autodraftTimer.current)
    autodraftTimer.current = setTimeout(() => autodraftWriteRef.current(), 1000)
  }, [])
  const clearAutodraft = useCallback(() => {
    try { if (typeof window !== 'undefined') sessionStorage.removeItem(AUTODRAFT_KEY) } catch { /* storage disabled */ }
  }, [])
  const markDirty = () => { setIsDirty(true); scheduleAutodraft() }

  // Every style control is a design change. Guarded so this effect's own mount
  // run doesn't declare a fresh, untouched canvas dirty.
  const styleDirtyMounted = useRef(false)
  useEffect(() => {
    if (!styleDirtyMounted.current) { styleDirtyMounted.current = true; return }
    if (reflectingRef.current) return  // selecting a text isn't a design change
    markDirty()
  }, [selectedFont, textColor, isBold, isItalic, isUppercase, textAlign,
      letterSpacing, lineHeight, textDirection, textOutline, curveAmount, fontSize])
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
  // D2 Design Portability: the saved design the customer chose "Use on another product" for.
  // Opening the picker while it's set; on pick we navigate to the designer for the target product
  // with the same design_id + refit=1 (the design_orders row carries the frozen source print box).
  const [portDesign, setPortDesign] = useState<SavedDesign | null>(null)
  // D2.5 switch-garment: the Products rail opens the picker; on pick we snapshot the CURRENT draft and
  // re-open it on the chosen product via the same design_id+refit path (switch = quick re-open).
  const [switchOpen, setSwitchOpen] = useState(false)
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

  // Compute + apply THIS product's print area for a given print METHOD. A hat can carry a different
  // print area per method (embroidery vs screen-print), so a method toggle must re-pick. Reads the
  // cached template + mockup natural size (no refetch). Logic lifted VERBATIM from the product-load
  // block, so single-method products are unaffected; the method-reactive effect below re-invokes it.
  // Returns true if an area was applied (false → no area for that method; caller keeps the fallback).
  const applyTemplateAreaForMethod = useCallback((m: string): boolean => {
    const tpl = loadedTemplateRef.current
    const natural = mockupNaturalRef.current
    if (!tpl || !natural) return false
    const areas = (tpl.product_template_print_areas || []) as any[]
    const forMethod = areas.filter(a => a.print_method === m)
    const pickSide = (side: string) =>
      forMethod.filter(a => a.side === side).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0] || null
    const toPct = (a: any) => (a ? toPctContain(a, natural.w, natural.h, 680, 850) : null)
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
      return true
    }
    return false
  }, [])

  // Re-pick the print area for the CURRENT method — fires both when the customer toggles the method AND
  // when the template finishes loading (templateReadyTick). The latter matters when the resolved method
  // equals the initial one (setPrintMethod is then a no-op). This is the SINGLE place the templated
  // print area is applied, so it always matches the live printMethod even if a toggle raced the load.
  // No-op for non-templated products or before the template loads (applyTemplateAreaForMethod → false).
  useEffect(() => {
    if (printMethod) applyTemplateAreaForMethod(printMethod)
  }, [printMethod, templateReadyTick, applyTemplateAreaForMethod])

  // If this product doesn't offer Names & Numbers, never sit on the (now-hidden) Names tab.
  useEffect(() => {
    if (!namesNumbersEnabled && activeTab === 'names') setActiveTab('text')
  }, [namesNumbersEnabled, activeTab])

  // Warn+convert follow-through: after a confirmed switch to embroidery, restyle existing text to the
  // now-loaded embroidery font + thread color. The embroidery fonts/colors load ASYNC after setPrintMethod,
  // so this MUST wait until configMethod === 'embroidery' (both palettes are non-empty, so length can't
  // tell them apart — gating on length restyled text to the stale PRINT font, then locked itself out).
  // Skips N&N placeholders (their own font system) and curved-text bakes (not i-text).
  useEffect(() => {
    if (printMethod !== 'embroidery' || !pendingEmbConvertRef.current) return
    if (configMethod !== 'embroidery' || !dbFonts.length) return // embroidery palette not loaded yet
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const font = dbFonts[0]?.value
    const thread = dbColors.find((c: any) => c.label === 'Black')?.hex || dbColors[0]?.hex
    const restyle = (o: any) => {
      if (!o || o[NN_ROLE_PROP] || (o.type !== 'i-text' && o.type !== 'textbox')) return
      if (font) o.set({ fontFamily: font })
      if (thread) o.set({ fill: thread })
      // The embroidery font has different metrics than the print font, so text sized to fill the box
      // now overflows it. Recompute dimensions with the new font, THEN re-fit + re-constrain to the
      // print area (same path every text mutation uses) — otherwise the converted text lands outside.
      o.initDimensions?.()
      fitAndConstrain(o)
    }
    const applyConversion = () => {
      ;[...canvas.getObjects(), ...frontObjectsRef.current, ...backObjectsRef.current].forEach(restyle)
      canvas.renderAll()
      pendingEmbConvertRef.current = false
      markDirty()
    }
    // Measure ONLY after the embroidery font has actually loaded. reWrapText sizes text via
    // canvas measureText; if the font isn't loaded yet it measures a FALLBACK font (smaller metrics),
    // then the real font renders larger and the text spills outside the box (the "less drastic but still
    // outside" case). document.fonts.load resolves immediately if there's nothing to fetch.
    const fonts = (document as unknown as { fonts?: { load?: (f: string) => Promise<unknown> } }).fonts
    if (font && fonts?.load) fonts.load(`32px "${font}"`).then(applyConversion).catch(applyConversion)
    else applyConversion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printMethod, configMethod, dbFonts, dbColors])

  useEffect(() => {
    fabricCanvasRef.current = fabricCanvas
  }, [fabricCanvas])

  // Rehydrate the canvas + surrounding state from a DesignState. Shared by the login-restore path
  // AND the auto-draft (local snapshot) restore, so the two can't drift. Front objects load into the
  // live canvas; back objects live in the ref (the Back toggle enlivens them); color/qty/uploads
  // re-applied AFTER the product's defaults so the saved values win.
  const applyDesignState = useCallback(async (state: any) => {
    const canvas = fabricCanvasRef.current
    if (!canvas || !state) return
    // Suppress the auto-draft writer for the whole restore: loadFromJSON leaves the canvas briefly
    // empty, and a queued write firing then would wipe the snapshot. Cancel any pending write too.
    isRestoringRef.current = true
    if (autodraftTimer.current) { clearTimeout(autodraftTimer.current); autodraftTimer.current = null }
    try {
      const { util } = await import('fabric')
      if (state.front) await canvas.loadFromJSON(state.front)
      if (state.back?.objects?.length) backObjectsRef.current = (await util.enlivenObjects(state.back.objects)) as any[]
      else backObjectsRef.current = []
      frontObjectsRef.current = []
      canvas.discardActiveObject()
      canvas.renderAll()
      if (state.selectedColor) {
        setSelectedColor(state.selectedColor)
        setShirtHex(COLOR_HEX_MAP[state.selectedColor] || '#888')
        const imgs = getColorImages(state.selectedColor, colorImageMap)
        const restoreSrc = imgs?.front || firstImageUrlRef.current
        if (restoreSrc && shirtImgRef.current) shirtImgRef.current.src = restoreSrc
        const match = product?.variants.edges.find(({ node }) =>
          node.selectedOptions.some((o: any) => o.name === 'Color' && o.value === state.selectedColor),
        )
        if (match) setSelectedVariant(match.node)
      }
      if (state.printMethod) setPrintMethod(state.printMethod)
      if (state.quantities) setQuantities(state.quantities)
      if (Array.isArray(state.uploadedFiles)) uploadedFilesRef.current = state.uploadedFiles
      if (Array.isArray(state.roster)) setRoster(state.roster)
      setShirtView('front')
    } finally {
      isRestoringRef.current = false
    }
  }, [product, colorImageMap])

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

        await applyDesignState(state)
      } catch (err) {
        console.error('[designer] restore failed:', err)
      } finally {
        cleanUrl()
      }
    })()
  }, [restoreId, fabricCanvas, product, colorImageMap, applyDesignState])

  // Auto-draft restore: bring back an UNSAVED design after an accidental refresh / pull-to-refresh.
  // ONLY on a genuine reload of the SAME product, and ONLY when no explicit server restore (login
  // ?restore= or Edit-design ?design_id=) is in play — those authoritative paths take precedence.
  // The reload gate is the anti-hijack rule: a fresh navigation to a product you designed earlier
  // this session must NOT resurrect that snapshot onto a blank canvas.
  const autodraftRestoredRef = useRef(false)
  useEffect(() => {
    if (autodraftRestoredRef.current || !fabricCanvas || !product) return
    if (restoreId || designId) return
    autodraftRestoredRef.current = true
    if (typeof window === 'undefined') return
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const isReload = nav?.type === 'reload'
    let env = null
    try { env = parseEnvelope(sessionStorage.getItem(AUTODRAFT_KEY)) } catch { /* storage disabled */ }
    if (!shouldRestore(env, { isReload, currentProductId: product.id || productId })) {
      // Fresh (non-reload) navigation into a blank designer: drop any leftover same-product snapshot
      // so a later accidental reload can't resurrect an abandoned design onto THIS new session. As
      // the customer designs, the writer re-persists this session's own work.
      if (!isReload) clearAutodraft()
      return
    }
    applyDesignState((env as { state: unknown }).state)
  }, [fabricCanvas, product, restoreId, designId, productId, applyDesignState, clearAutodraft])

  // Flush the pending debounced snapshot before the page unloads/hides, so the last <=1s of work
  // (including the FIRST edit of a fresh design, which has no prior snapshot to fall back to) survives
  // a reload. pagehide covers reload/close/nav-away; visibilitychange->hidden is the mobile-reliable
  // backup. The writer's own ready/restoring guard makes an early flush a safe no-op.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const flush = () => {
      if (autodraftTimer.current) { clearTimeout(autodraftTimer.current); autodraftTimer.current = null }
      autodraftWriteRef.current()
    }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

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
        baseText, fontSize, selectedFont, isBold, isItalic, letterSpacing * 10, lineHeight
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
        lineHeight: lineHeight,
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
          productSizesRef.current = resolvedSizes
          setQuantities(prev => resolvedSizes.reduce(
            (acc: Record<string, number>, s: string) => ({ ...acc, [s]: prev[s] ?? 0 }), {}))
          // Check raw image URLs for actual _back files
          const anyBack = allImages.some(({ url }: { url: string }) =>
            url.split('/').pop()?.toLowerCase().includes('_back')
          )
          setHasBackImages(anyBack)
          // Parse print method
          // Initial print method from the metafield (default screen_print); the template can override it
          // below. setPrintMethod drives the fetchDesignerConfig effect, which loads fonts/colors/pricing
          // for the method AND tags configMethod — so there's no separate inline fetch to keep in sync
          // (removing it also kills the old double-fetch race when template method ≠ metafield method).
          const method = data.printMethod?.value || 'screen_print'
          setPrintMethod(method)

          // Print area: prefer admin-managed product_templates; fall back to the
          // legacy Shopify metafield for products without a template row.
          ;(async () => {
            try {
              const { supabase } = await import('../lib/supabase')
              const { data: tpl } = await supabase
                .from('product_templates')
                .select('id, default_print_method, supported_print_methods, supports_names_numbers, product_template_print_areas(*), product_template_colors(*)')
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
              if (tpl) {
                // The TEMPLATE is the source of truth for the print method (embroidery mode). Keep the
                // metafield method when the template supports it, else fall to the template default;
                // expose the supported set so the designer shows a Print/Embroidery toggle when >1.
                loadedTemplateRef.current = tpl
                const supported = (tpl.supported_print_methods as string[] | null) || []
                setSupportedMethods(supported)
                setNamesNumbersEnabled(tpl.supports_names_numbers !== false) // default ON unless explicitly off
                // The TEMPLATE's default_print_method is the source of truth for what a product opens on
                // — NOT the legacy Shopify `designer.printMethod` metafield (a leftover 'embroidery'
                // metafield must not override a template set to open on Print). Metafield is only the
                // fallback for products with no template at all.
                const resolved = tpl.default_print_method || method
                if (areas.length > 0) {
                  // Derive the mockup's natural size from the FIRST image that actually loads (not just
                  // allImages[0] — the onesie's renamed URLs could be broken) and CACHE it so a toggle
                  // can re-pick the per-method area without a refetch.
                  let natural: { w: number; h: number } | null = null
                  for (const img of allImages) {
                    natural = await getImageNaturalSize(img.url)
                    if (natural) break
                  }
                  mockupNaturalRef.current = natural
                }
                // Set the resolved method UNLESS the customer already toggled during this async load (don't
                // clobber their choice). React dedupes a same-value set; the templateReadyTick bump below
                // fires the print-area effect either way, so the area is applied for the LIVE method — a
                // toggle-during-load can't strand an embroidery method on the print box.
                if (!userToggledMethodRef.current) setPrintMethod(resolved)
                setTemplateReadyTick(t => t + 1)
                return // templated products use the template area (via the effect), never the metafield
              } else {
                setSupportedMethods([])
                setNamesNumbersEnabled(true) // non-templated products keep N&N
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
            // D2 color reconcile: with no variant pinning a color, prefer the carried ?color= when the
            // target actually offers it by exact name (a ported design keeps its color), else firstColor.
            const carriedColor = initialColor && colorOption.values.includes(initialColor) ? initialColor : null
            const resolvedColor = matchedColor || carriedColor || firstColor
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
        // Remember a curved text is being SCALE-dragged, so object:modified re-bakes it (and only it).
        if (obj._isCurvedText) curvedScaleGestureRef.current = obj
        // Live low-res: scaling a raster upload UP lowers its effective DPI — refresh the warning as
        // the customer drags so it appears/disappears in real time (no-op for non-raster objects).
        refreshLowRes(obj)
        const bounds = getLiveBounds()
        if (!bounds) return

        const boundsW = bounds.right  - bounds.left
        const boundsH = bounds.bottom - bounds.top

        // Clamp scale so the object's ROTATED footprint never exceeds the print area (at angle 0 this is
        // the plain box/size fit). Keeps a tilted object fully inside so it can't poke out — which the
        // cut/layout engine would crop. Both scale axes clamp to the same uniform cap (image handles
        // scale equally; text/clipart at normal sizes are already under the cap so this never bites them).
        const maxScale = maxScaleForRotation(obj.width || 1, obj.height || 1, obj.angle || 0, boundsW, boundsH)

        if (obj.scaleX > maxScale) obj.set({ scaleX: maxScale })
        if (obj.scaleY > maxScale) obj.set({ scaleY: maxScale })

        // Then constrain position
        constrainObject(obj, bounds)
      })

      // Rotating grows the axis-aligned footprint, so a box-filling object would poke out as it tilts.
      // Auto-shrink it to the rotated-fit cap (Denise 2026-08-06) so it stays fully inside — normal-sized
      // art is already under the cap and never shrinks — then re-clamp position.
      canvas.on('object:rotating', (e: any) => {
        const obj = e.target
        if (!obj) return
        const bounds = getLiveBounds()
        if (!bounds) return
        const maxScale = maxScaleForRotation(obj.width || 1, obj.height || 1, obj.angle || 0, bounds.right - bounds.left, bounds.bottom - bounds.top)
        if (obj.scaleX > maxScale) obj.set({ scaleX: maxScale })
        if (obj.scaleY > maxScale) obj.set({ scaleY: maxScale })
        constrainObject(obj, bounds)
      })

      // Track selected object text for font preview
      canvas.on('selection:created', (e: any) => {
        const obj = e.selected?.[0]
        if (obj) { lastActiveObjectRef.current = obj; _activeObj = obj }
        // A curve re-bake swaps the object under us — keep the refs, but don't
        // re-run the tab-switch/reflect on every frame (that was the "shake").
        if (curveBakingRef.current) return
        // Selecting via a Layers row must NOT navigate away from the Layers tab (that's where the
        // customer is reordering) — the guard skips only the tab-switch; everything else reflects.
        if (obj) { if (!selectingFromLayersRef.current) setActiveTab(sectionForObject(obj)); setSelectedNnRole(obj[NN_ROLE_PROP] ?? null); refreshLowRes(obj) }
        setLayersTick(t => t + 1) // keep the Layers row highlight in sync with the canvas selection
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
        // Selecting via a Layers row must NOT navigate away from the Layers tab (that's where the
        // customer is reordering) — the guard skips only the tab-switch; everything else reflects.
        if (obj) { if (!selectingFromLayersRef.current) setActiveTab(sectionForObject(obj)); setSelectedNnRole(obj[NN_ROLE_PROP] ?? null); refreshLowRes(obj) }
        setLayersTick(t => t + 1) // keep the Layers row highlight in sync with the canvas selection
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
          setSelectedObjectType(null); setLowResWarning(null)
          setTextInput('')
        }
      })
      canvas.on('selection:cleared', () => {
        setSelectedTextPreview('')
        setSelectedObjectType(null); setLowResWarning(null)
        setSelectedNnRole(null)
        setTextInput('')
        // Tapping empty shirt space (deselect) = "I'm done with tools" → collapse the
        // mobile band so the shirt returns to full size. BUT only when the text box
        // isn't focused: creating a text on the first keystroke fires selection:cleared
        // (the old object is discarded before the new one selects) while the box IS
        // focused — closing then would unmount the docked box mid-type. So gate on the
        // textarea NOT being the active element. Harmless on desktop (no band).
        if (document.activeElement !== textInputRef.current) setBandOpen(false)
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
        // Curved text baked to a raster: a scale gesture pixelates the bitmap. Re-bake the arc at the
        // settled size instead of leaving it scaled (rebakeCurvedOnResize does its own fit/constrain).
        // Gate on the scale-gesture flag (set in object:scaling), NOT on scaleX≠1 — a clamped/restored
        // curved text carries scale<1 permanently, so a bare scale test would re-bake on plain moves.
        const wasScaled = curvedScaleGestureRef.current === obj
        curvedScaleGestureRef.current = null
        if (obj?._isCurvedText && wasScaled) {
          void rebakeCurvedOnResize(obj)
          return
        }
        const bounds = getLiveBounds()
        if (obj && bounds) constrainObject(obj, bounds)
        refreshLowRes(obj) // reflect the settled size (a clamp may have shrunk it back under the box)
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
          if (obj._isCropRect) return // the crop frame keeps its own edge-only handles — no delete/rotate
          // Locked jersey placeholder: DELETE only — no move/resize/rotate handles (the locks also
          // enforce it functionally). Applies on both platforms.
          if (obj[NN_ROLE_PROP]) { obj.controls = { deleteControl }; obj.setCoords(); return }
          // MOBILE uses its own 3-disc control set (applied by the mobile effect, which
          // also hooks object:added). Skip the desktop red-circle set here so the two
          // systems don't fight (the desktop set was overriding the mobile discs on
          // re-add/restore, showing the old red handles). Desktop is unchanged.
          if (isMobileRef.current) return
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

  // Headless curved-text bake: rasterize the arc (renderCurvedArc — the SAME pixel code the slider
  // path uses, now shared) then wrap it in a stamped, placed, print-area-constrained FabricImage. No
  // active-object / React-state reads — the curve slider effect calls it for the selected object; the
  // D2 re-fit path calls it per _isCurvedText object to re-curve onto the target garment.
  const bakeCurvedArc = async (
    rawText: string,
    p: { curveAmount: number; fontSize: number; fontFamily: string; fill: string; bold: boolean; italic: boolean; charSpacing?: number },
    left: number, top: number,
    bounds: { left: number; top: number; right: number; bottom: number } | null,
  ): Promise<any> => {
    const { dataUrl } = renderCurvedArc(rawText, p)
    const { FabricImage } = await import('fabric')
    const img: any = await FabricImage.fromURL(dataUrl)
    img.set({ left, top, originX: 'center', originY: 'center' })
    img._isCurvedText = true
    img._originalText = rawText
    // Stamp the exact params this was baked with, so selecting the curved text reflects them and
    // adjusting re-bakes from its OWN font/size/color.
    img._curveAmount = p.curveAmount
    img._curveFontFamily = p.fontFamily
    img._curveFontSize = p.fontSize
    img._curveFill = p.fill
    img._curveBold = p.bold
    img._curveItalic = p.italic
    img._curveCharSpacing = p.charSpacing ?? 0
    // Keep the baked curved text inside the print area (Issue-2).
    if (bounds) {
      const maxScale = Math.min(
        (bounds.right - bounds.left) / (img.width || 1),
        (bounds.bottom - bounds.top) / (img.height || 1),
      )
      if (maxScale < 1) img.set({ scaleX: maxScale, scaleY: maxScale })
      constrainObject(img, bounds)
    }
    return img
  }

  // D2 port follow-ups: after refitSide has re-projected a side's geometry onto the target box, run the
  // DOM-coupled refinements per object (the pure engine can't): curved text re-curves at the scaled
  // size, plain text re-wraps to the new box width from _originalText (re-applying uppercase) and
  // constrains, images/clipart just constrain. N&N placeholders are skipped — applyStackLayout
  // regenerates their geometry from the target print box on its own. Front side only (live canvas).
  const refitFollowups = async (objs: any[], scale: number, targetLTRB: { left: number; top: number; right: number; bottom: number } | null) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    for (const obj of objs) {
      if (obj[NN_ROLE_PROP]) continue // applyStackLayout owns N&N geometry on the target box
      if (obj._isCurvedText) {
        const p = rebakeCurveParams(Number(obj._curveFontSize) || 36, Number(obj._curveAmount) || 0, scale)
        const rebaked = await bakeCurvedArc(
          String(obj._originalText || ''),
          { curveAmount: p.curveAmount, fontSize: p.curveFontSize, fontFamily: String(obj._curveFontFamily || 'Impact'), fill: String(obj._curveFill || '#000000'), bold: !!obj._curveBold, italic: !!obj._curveItalic, charSpacing: Number(obj._curveCharSpacing) || 0 },
          obj.left, obj.top, targetLTRB,
        )
        canvas.remove(obj); canvas.add(rebaked)
      } else if (obj.type === 'i-text' || obj.type === 'textbox') {
        const raw = String(obj._originalText || obj.text || '')
        const { text, fontSize } = reWrapText(raw, Number(obj.fontSize) || 36, obj.fontFamily, obj.fontWeight === 'bold', obj.fontStyle === 'italic', Number(obj.charSpacing) || 0, typeof obj.lineHeight === 'number' ? obj.lineHeight : 1.2)
        const wasUpper = raw !== '' && norm(String(obj.text || '')) === norm(raw.toUpperCase()) && norm(String(obj.text || '')) !== norm(raw)
        obj.set({ text: wasUpper ? text.toUpperCase() : text, fontSize })
        if (targetLTRB) constrainObject(obj, targetLTRB)
      } else if (targetLTRB) {
        constrainObject(obj, targetLTRB)
      }
    }
    canvas.renderAll()
  }

  // Curved text is a baked raster, so a manual corner-drag scales the BITMAP → pixelation. When a
  // resize gesture settles (object:modified), re-render the arc at the new size so it stays crisp —
  // the same rebakeCurveParams + bakeCurvedArc the curve slider and the D2 port already use. Reuses
  // the slider's swap guards (curveTokenRef drops a stale re-bake from rapid resizes; curveBakingRef
  // suppresses the panel churn on re-select). Rotation is carried across (bakeCurvedArc omits angle);
  // a non-uniform side-handle drag collapses to scaleX — curved arcs are always fixed-aspect anyway.
  const rebakeCurvedOnResize = async (obj: any) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    // Corner drags keep aspect (scaleX==scaleY); a side-handle drag distorts one axis. Either way an
    // arc is fixed-aspect, so re-bake at the LARGER extent and reset to uniform scale.
    const k = Math.max(obj.scaleX || 1, obj.scaleY || 1)
    const p = rebakeCurveParams(Number(obj._curveFontSize) || 36, Number(obj._curveAmount) || 0, k)
    const myToken = ++curveTokenRef.current
    const rebaked = await bakeCurvedArc(
      String(obj._originalText || ''),
      { curveAmount: p.curveAmount, fontSize: p.curveFontSize, fontFamily: String(obj._curveFontFamily || 'Impact'), fill: String(obj._curveFill || '#000000'), bold: !!obj._curveBold, italic: !!obj._curveItalic, charSpacing: Number(obj._curveCharSpacing) || 0 },
      obj.left, obj.top, getPrintAreaBounds(),
    )
    if (myToken !== curveTokenRef.current) return // superseded by a newer bake (rapid resize/slider)
    if (obj.angle) { rebaked.set({ angle: obj.angle }); rebaked.setCoords() }
    curveBakingRef.current = true
    canvas.add(rebaked)
    canvas.setActiveObject(rebaked)
    curveBakingRef.current = false
    if (obj !== rebaked) canvas.remove(obj)
    lastActiveObjectRef.current = rebaked
    _activeObj = rebaked
    canvas.renderAll()
    markDirty()
  }

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
          textAlign: textAlign, charSpacing: letterSpacing * 10, lineHeight: lineHeight,
          originX: 'center', originY: 'center',
        })
        ;(textObj as any)._originalText = rawText
        swap(textObj)
        return
      }

      // curve !== 0 → bake the arc to a stamped image via the shared headless renderer (renderCurvedArc
      // inside bakeCurvedArc is the exact pixel code that used to live here).
      const img = await bakeCurvedArc(
        rawText,
        { curveAmount: cAmount, fontSize: cSize, fontFamily: cFont, fill: cFill, bold: cBold, italic: cItalic, charSpacing: letterSpacing * 10 },
        spawnX, spawnY, getPrintAreaBounds(),
      )
      if (myToken !== curveTokenRef.current) return  // superseded while baking/decoding
      swap(img)
    }

    // Coalesce to one bake per animation frame; the cleanup cancels a not-yet-fired
    // frame, so rapid slider ticks collapse to a single bake of the latest value.
    if (curveRafRef.current != null) cancelAnimationFrame(curveRafRef.current)
    curveRafRef.current = requestAnimationFrame(() => { curveRafRef.current = null; void doBake() })
    return () => {
      if (curveRafRef.current != null) { cancelAnimationFrame(curveRafRef.current); curveRafRef.current = null }
    }
  }, [curveAmount, fontSize, selectedFont, textColor, isBold, isItalic, letterSpacing])

  // Clears the pull-on-select guard. Declared AFTER every push/dirty/curve
  // effect above, so on the batched mirror commit it flushes last — the guarded
  // effects have already bailed, and the next real knob change (guard false)
  // pushes normally. Runs every commit; idempotent when the guard is already off.
  useEffect(() => { reflectingRef.current = false })

  const reWrapText = (text: string, targetFontSize: number, fontFamily: string, bold: boolean, italic: boolean, charSpacing: number = 0, lineHeightFactor: number = 1.2): { text: string; fontSize: number } => {
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
    while (autoFontSize > 8 && lines.length * autoFontSize * lineHeightFactor > maxHeight) {
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

  // Low-resolution check for a RASTER upload. Tier 1: the file itself is tiny (longest side < 300px).
  // Tier 2: effective DPI at the PLACED size = source px ÷ placed inches, where placed inches come from
  // the same canvas-px→inch mapping the cut engine uses (placed px / print-box px × print-area inches;
  // inches from product_template_print_areas.width_in/height_in, side-specific). Returns the tailored
  // message or null. Skips vector clipart, curved-text bakes, and N&N placeholders. Never blocks — this
  // only drives a panel nudge. `obj.width` is the CURRENT element's natural px (post crop / bg-removal,
  // which correctly lowers the DPI).
  const lowResMessageFor = (obj: any): string | null => {
    if (!obj || obj.type !== 'image') return null
    if (obj._isSvg || obj._isVectorUpload || obj._isCurvedText || obj[NN_ROLE_PROP]) return null
    const srcW = Number(obj.width) || 0, srcH = Number(obj.height) || 0
    // Placed inches from the live print box (px) + its physical inches. If the box/inches aren't
    // available the placed-DPI check is skipped, but the tiny-FILE (Tier 1) check still fires. Read the
    // side from the REF — this runs from mount-time canvas handlers where `shirtView` state is stale.
    const bounds = getPrintAreaBounds()
    const snap = shirtViewRef.current === 'back' ? printAreaBackSnapRef.current : printAreaFrontSnapRef.current
    const boxW = bounds ? bounds.right - bounds.left : 0, boxH = bounds ? bounds.bottom - bounds.top : 0
    const placedInW = placedInches(obj.getScaledWidth?.() || 0, boxW, Number(snap?.width_in) || 0)
    const placedInH = placedInches(obj.getScaledHeight?.() || 0, boxH, Number(snap?.height_in) || 0)
    const tier = lowResTier(srcW, srcH, placedInW, placedInH)
    return tier === 'small' ? LOWRES_MSG_SMALL : tier === 'placed' ? LOWRES_MSG_PLACED : null
  }
  const refreshLowRes = (obj: any) => setLowResWarning(lowResMessageFor(obj))

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
        typeof obj.lineHeight === 'number' ? obj.lineHeight : 1.2,
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
    setSelectedObjectType(null); setLowResWarning(null)
    textInputRef.current?.focus()
  }

  // ── Web-font measurement correctness ───────────────────────────────────────
  // A custom/web font (Google `display=swap` or a local @font-face) is measured by Fabric the moment
  // a text object is created — but if the font file hasn't downloaded yet, Fabric measures the
  // FALLBACK glyphs and CACHES those widths. The real font then swaps in on render, so the cached
  // bounding box disagrees with what's drawn: dead space beside the text, or text spilling past its
  // box. Everything positioned off those bounds — centering, condense-to-fit, the Phase-4 cut files —
  // inherits the error. Fabric's own remedy: wait for the font, drop the stale widths, re-measure.
  const ensureFontLoaded = async (family?: string) => {
    if (!family || typeof document === 'undefined' || !document.fonts?.load) return
    const primary = family.split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (!primary) return
    try {
      await Promise.all([
        document.fonts.load(`16px "${primary}"`),
        document.fonts.load(`700 16px "${primary}"`), // bold face measures separately
      ])
    } catch { /* unknown/local family the browser can't resolve — nothing to wait on */ }
  }

  // Re-measure the given text objects in place after their fonts are guaranteed loaded. Clears
  // Fabric's char-width cache (the documented step) so initDimensions() recomputes from the real
  // glyphs. Skips non-text and objects being edited (would disrupt the caret). Renders once.
  const remeasureTextObjects = async (objs: any[], families: string[]) => {
    await Promise.all(families.filter(Boolean).map(f => ensureFontLoaded(f)))
    const { cache } = await import('fabric')
    cache.clearFontCache()
    objs.forEach(o => {
      if (!o || o.isEditing || typeof o.initDimensions !== 'function') return
      o.initDimensions()
      o.setCoords?.()
    })
    fabricCanvasRef.current?.requestRenderAll()
  }

  // Names & Numbers placeholders: a stamped IText the roster substitutes at print time (name ->
  // each player's name, number -> their number). One of each — re-select the existing one rather
  // than duplicating. Selecting it routes to the Text panel so it can be styled like any text.
  // Snap every placeholder on the CURRENT side to its canonical jersey position + size for the current
  // composition. THE single source of truth for stack geometry — called on add/remove, side switch,
  // box change, and restore, so old (movable-regime) designs conform on reopen too. Never runs during
  // preview (which owns the substituted text/scaleX). Style (font/color) is untouched.
  // Position + size a set of N&N placeholders as the locked jersey stack within an explicit box.
  // PURE geometry (jerseyStackLayout is box-derived, not measurement-derived) and no canvas/DOM read,
  // so it works on OFF-CANVAS objects too — the back side during a D2 port, whose print-area overlay
  // isn't mounted yet. The live-canvas applyStackLayout below delegates here.
  const layoutStackInto = (placeholders: any[], box: { left: number; top: number; right: number; bottom: number }) => {
    if (!placeholders.length) return
    const present = placeholders.map(o => o[NN_ROLE_PROP] as NnRole)
    const layout = jerseyStackLayout(present, box)
    placeholders.forEach(o => {
      const spot = layout[o[NN_ROLE_PROP] as NnRole]
      if (!spot) return
      // Re-assert lock + non-editable here too, so designs saved under the old movable regime conform
      // (locked + canonical) the moment they're viewed, without a migration.
      o.set({ left: spot.left, top: spot.top, fontSize: spot.fontSize, scaleX: 1, scaleY: 1, angle: 0, originX: 'center', originY: 'center', editable: false, ...NN_TEXT_METRICS, ...NN_LOCK_PROPS })
      o.initDimensions?.()
      o.setCoords?.()
    })
  }

  const applyStackLayout = () => {
    const canvas = fabricCanvasRef.current
    if (!canvas || nnPreviewRef.current !== null) return
    const b = getPrintAreaBounds()
    if (!b) return
    layoutStackInto((canvas.getObjects() as any[]).filter(o => o[NN_ROLE_PROP]), b)
    canvas.requestRenderAll()
  }

  const addPlaceholder = async (role: NnRole) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const existing = (canvas.getObjects() as any[]).find(o => o[NN_ROLE_PROP] === role)
    if (existing) { canvas.setActiveObject(existing); canvas.renderAll(); return }
    const { IText } = await import('fabric')
    const b = getPrintAreaBounds()
    if (!b) {
      // No print box => nowhere to place the stack. This is why N&N looked "not usable" on a product
      // whose template/print-area didn't load. Surface it instead of silently doing nothing.
      console.warn('[nn] Add field ignored — no print area for this product/side.', { printArea: !!printArea, shirtView, hasBackImages })
      return
    }
    const sample = role === 'name' ? 'NAME' : role === 'title' ? 'TITLE' : '00'
    // Font + color DEFAULT-MATCH an existing field (jerseys want one look); SIZE + POSITION are
    // canonical/locked — applyStackLayout arranges the whole stack right after this add. Sibling may
    // be on the other side, so look across both refs.
    const sibling = [...canvas.getObjects(), ...frontObjectsRef.current, ...backObjectsRef.current]
      .find((o: any) => o && o[NN_ROLE_PROP] && o[NN_ROLE_PROP] !== role)
    const font = sibling?.fontFamily ?? selectedFont
    const fill = sibling?.fill ?? textColor
    const t: any = new IText(sample, {
      left: b.left + (b.right - b.left) / 2, top: b.top + (b.bottom - b.top) / 2,
      originX: 'center', originY: 'center', textAlign: 'center',
      fontFamily: font, fill,
      ...NN_TEXT_METRICS, // hug the glyphs (single-line box ignores lineHeight — see NN_TEXT_METRICS)
      editable: false,   // the value fills in per roster row — never typed on the canvas
      ...NN_LOCK_PROPS,   // no move/resize/rotate — geometry is canonical
    })
    t[NN_ROLE_PROP] = role
    t._originalText = sample
    canvas.add(t)
    applyStackLayout()   // position + size the full stack for the new composition
    canvas.setActiveObject(t)
    canvas.renderAll()
    markDirty()
    // Correct the box once the font is really loaded (it may have measured a fallback just now).
    void remeasureTextObjects([t], [font])
  }
  const addNameField = () => addPlaceholder('name')
  const addNumberField = () => addPlaceholder('number')
  const addTitleField = () => addPlaceholder('title')

  // Re-apply the canonical stack whenever the composition, side, or print box changes (covers add,
  // remove via any delete path, side swap, product load, and restore). Cheap + idempotent.
  useEffect(() => {
    applyStackLayout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasObjectCount, shirtView, printArea])

  // ── Live roster preview ────────────────────────────────────────────────────
  // Substitute one roster entry onto the placeholders, fit each to its box (keep the styled height,
  // condense width — condensedScaleX), and remember the sample so exit restores it exactly. Purely
  // visual: guarded everywhere a save/side-swap could otherwise capture the substituted text.
  const rosterContentEntries = () => roster.filter(entryHasContent)

  const applyNnPreview = (i: number) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const entries = rosterContentEntries()
    if (!entries.length) return
    const idx = ((i % entries.length) + entries.length) % entries.length
    const entry = entries[idx]
    const b = getPrintAreaBounds()
    const saved = nnPreviewSavedRef.current
    canvas.getObjects().forEach((o: any) => {
      const role = o[NN_ROLE_PROP] as NnRole | undefined
      if (role !== 'name' && role !== 'number' && role !== 'title') return
      if (!saved.has(o)) saved.set(o, { text: o.text, scaleX: o.scaleX ?? 1 })
      const base = saved.get(o)!
      const value = rosterValue(entry, role) || ' ' // uppercased for name/title
      o.set({ text: value, scaleX: base.scaleX })
      o.initDimensions?.() // force width recompute so the fit measures the substituted string
      if (b) o.scaleX = condensedScaleX(o.width, (b.right - b.left) * 0.96, base.scaleX)
      o.setCoords?.()
    })
    canvas.discardActiveObject()
    canvas.renderAll()
    nnPreviewRef.current = idx
    setNnPreviewIndex(idx)
  }

  const enterNnPreview = async () => {
    if (!rosterContentEntries().length) return
    // Guarantee the placeholders' fonts are loaded + the cache is clean before the condense-fit
    // measures widths — otherwise a fallback measurement would let a long value spill the box.
    const canvas = fabricCanvasRef.current
    const fams = canvas ? (canvas.getObjects() as any[]).filter(o => o[NN_ROLE_PROP]).map(o => o.fontFamily) : []
    await Promise.all(Array.from(new Set(fams)).map(f => ensureFontLoaded(f)))
    const { cache } = await import('fabric')
    cache.clearFontCache()
    applyNnPreview(0)
  }
  const stepNnPreview = (delta: number) => { if (nnPreviewRef.current !== null) applyNnPreview(nnPreviewRef.current + delta) }

  // Restore the sample text + base scaleX on every previewed placeholder. Idempotent — safe to call
  // from any guard (snapshot, side-swap, tab-away) even when no preview is active.
  const exitNnPreview = () => {
    const canvas = fabricCanvasRef.current
    const saved = nnPreviewSavedRef.current
    if (canvas && saved.size) {
      canvas.getObjects().forEach((o: any) => {
        const s = saved.get(o)
        if (!s) return
        o.set({ text: s.text, scaleX: s.scaleX })
        o.initDimensions?.()
        o.setCoords?.()
      })
      canvas.renderAll()
    }
    saved.clear()
    nnPreviewRef.current = null
    setNnPreviewIndex(null)
  }

  // Front/Back toggle, shared by the two stage buttons AND the N&N auto-show-back effect. Saves the
  // current side's objects into its ref, loads the target side's objects, and swaps the shirt image +
  // print area. Exits any live preview first so a substitution can't be swapped into the other side.
  const switchView = (target: 'front' | 'back') => {
    if (shirtView === target) return
    exitNnPreview()
    const canvas = fabricCanvasRef.current
    if (canvas) {
      if (shirtView === 'front') frontObjectsRef.current = canvas.getObjects().map((o: any) => o)
      else backObjectsRef.current = canvas.getObjects().map((o: any) => o)
      canvas.clear()
      const targetObjs = target === 'front' ? frontObjectsRef.current : backObjectsRef.current
      targetObjs.forEach((o: any) => canvas.add(o))
      canvas.renderAll()
    }
    setShirtView(target)
    const imgs = getColorImages(selectedColor, colorImageMap)
    const src = (target === 'front' ? imgs?.front : imgs?.back) || firstImageUrlRef.current
    if (src && shirtImgRef.current) shirtImgRef.current.src = src
    const pa = target === 'front' ? printAreaDataRef.current?.front : printAreaDataRef.current?.back
    if (pa) { setPrintArea(pa); window.dispatchEvent(new Event('printAreaChanged')) }
  }

  // D2 lazy back-refit: consume the pending back re-fit the first time the customer flips to Back.
  // Runs AFTER switchView has swapped the back objects onto the live canvas and repositioned the
  // print-area overlay, so getPrintAreaBounds() (which reads that overlay) returns the BACK box.
  // Guarded by isRestoringRef so the auto-draft writer can't snapshot the mid-refine canvas.
  useEffect(() => {
    if (shirtView !== 'back' || backRefitPendingRef.current === null) return
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    const bounds = getPrintAreaBounds()
    if (!bounds) return // overlay not laid out yet — a later render re-runs this effect
    const scale = backRefitPendingRef.current
    backRefitPendingRef.current = null
    isRestoringRef.current = true
    ;(async () => {
      try {
        await refitFollowups(canvas.getObjects() as any[], scale, bounds)
        applyStackLayout() // re-stack any N&N placeholders now living on the back onto its box
      } finally {
        backObjectsRef.current = canvas.getObjects().map((o: any) => o)
        isRestoringRef.current = false
        markDirty()
      }
    })()
  }, [shirtView, printArea]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the garment IMAGE in agreement with the current side + color. switchView sets it imperatively,
  // but an EFFECT-triggered flip (the N&N auto-show-back below) can run while colorImageMap/selectedColor
  // are still populating from an async product load — a stale closure that flipped the VIEW to Back while
  // the image stayed on Front (Bug 3, surfaced porting an N&N-on-back design). This reactive sync is the
  // backstop: whenever side/color/map settle, the image is re-derived from the CURRENT values, so the
  // image can never disagree with the buttons regardless of how the flip was triggered.
  useEffect(() => {
    const imgs = getColorImages(selectedColor, colorImageMap)
    const url = (shirtView === 'back' ? imgs?.back : imgs?.front) || firstImageUrlRef.current
    if (url && shirtImgRef.current) shirtImgRef.current.src = url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shirtView, selectedColor, colorImageMap])

  // Auto-show-back on the Names tab was REMOVED (Denise, 2026-08-06). An effect-triggered switchView
  // raced the async product load (colorImageMap not yet populated), flipping the buttons to Back while
  // the image stayed on Front — most visibly when porting a back-stack N&N design. The whole surface is
  // simpler without it: N&N opens on the current side and the customer flips manually (which always
  // shows the right image, backed by the image↔side sync effect above). Restore/port still land on
  // Front; the jersey stack is re-fit onto the correct side regardless (eager back-N&N re-stack + the
  // lazy back-refit on first flip). If a default-to-back-on-fresh-N&N is ever wanted again, drive it
  // from an explicit user action, not a load-time effect.

  // Leaving the Names tab must drop the preview (its controls unmount, but the substituted text
  // would otherwise stay on the canvas). Side-swap and every save path guard synchronously at their
  // own call sites (a React effect runs too late — the swap reads getObjects() first).
  useEffect(() => {
    if (nnPreviewIndex !== null && activeTab !== 'names') exitNnPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // If the roster loses all content or the placeholders are removed mid-preview, the strip (with its
  // "Done" button) unmounts — so auto-exit here, or the substituted text would be stranded on the
  // canvas with no way back to the sample.
  useEffect(() => {
    const stillValid = (nnFields.name || nnFields.number || nnFields.title) && roster.some(entryHasContent)
    if (nnPreviewIndex !== null && !stillValid) exitNnPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, nnFields, nnPreviewIndex])

  // Keep the panel's "Name field ✓ / Number field ✓" indicators in sync — across BOTH sides. A
  // placeholder often lives on the back (auto-show-back), which sits in backObjectsRef, not the live
  // canvas; checking only the live canvas would show "Add Name field" after an Edit restore even
  // though the field exists on the back. shirtView is a dep so the counts refresh on a side swap.
  useEffect(() => {
    const c = fabricCanvasRef.current
    if (!c) return
    const all = [...(c.getObjects() as any[]), ...frontObjectsRef.current, ...backObjectsRef.current]
    setNnFields({
      name: all.some(o => o[NN_ROLE_PROP] === 'name'),
      number: all.some(o => o[NN_ROLE_PROP] === 'number'),
      title: all.some(o => o[NN_ROLE_PROP] === 'title'),
    })
  }, [canvasObjectCount, shirtView])

  // Rail = "add a NEW one." Selection drives the panel while something's picked,
  // so switching rail category means "leave edit mode": drop the selection
  // (selection:cleared resets selectedObjectType → the panel shows the chosen
  // category's ADD surface) and set the tab.
  const handleSelectTab = (tab: 'text' | 'upload' | 'clipart' | 'names' | 'layers') => {
    const canvas = fabricCanvasRef.current
    if (canvas) {
      canvas.discardActiveObject()
      canvas.renderAll()
    }
    setActiveTab(tab)
  }

  // Print/Embroidery toggle (embroidery mode). Changing the method re-swaps fonts/colors/pricing/print
  // area (via the printMethod effects) and hides/shows print-only tools. Step 3 wraps this with a
  // warn+convert guard when the switch would strip incompatible content (uploads, print-only text).
  const handleMethodSwitch = (m: string) => {
    if (!m || m === printMethod) return
    userToggledMethodRef.current = true // an in-flight product load must not clobber this choice
    const canvas = fabricCanvasRef.current
    const all = canvas
      ? [...canvas.getObjects(), ...frontObjectsRef.current, ...backObjectsRef.current]
      : [...frontObjectsRef.current, ...backObjectsRef.current]

    const isUpload = (o: any) => !!o?._uploadSrc
    const isClipart = (o: any) => typeof o?._isSvg === 'boolean' && !o?._uploadSrc // library art (not an upload)
    const isText = (o: any) => o && (o.type === 'i-text' || o.type === 'textbox') && !o[NN_ROLE_PROP]
    // Does a placed art carry into the target method `m`?
    //   • uploads are Print-only (the Upload tool is hidden in embroidery);
    //   • library art carries its own _supportedMethods stamp — KEEP it if the new method is in there
    //     (so dual-method clipart survives Print↔Embroidery). Legacy art with no stamp = Print-only.
    //   • text (and everything else) always survives.
    const artSurvives = (o: any) => {
      if (isUpload(o)) return m === 'screen_print'
      if (isClipart(o)) {
        const methods = (o as any)._supportedMethods
        return Array.isArray(methods) ? methods.includes(m) : m === 'screen_print'
      }
      return true
    }

    const toRemove = all.filter((o: any) => (isUpload(o) || isClipart(o)) && !artSurvives(o))
    const uploadsRemoved = toRemove.filter(isUpload).length
    const clipartRemoved = toRemove.filter(isClipart).length
    const hasText = all.some(isText)
    const willRestyleText = m === 'embroidery' && hasText

    if (toRemove.length || willRestyleText) {
      const removeLabel = [
        uploadsRemoved && 'uploaded images',
        clipartRemoved && `art that isn't available for ${methodLabel(m)}`,
      ].filter(Boolean).join(' and ')
      const bits = [
        removeLabel && `remove your ${removeLabel}`,
        willRestyleText && 'set your text to an embroidery font + thread color',
      ].filter(Boolean)
      if (bits.length && !window.confirm(`Switching to ${methodLabel(m)} will ${bits.join(' and ')}. Continue?`)) return
      if (toRemove.length) {
        const rm = new Set(toRemove)
        toRemove.forEach((o: any) => canvas?.remove(o))
        frontObjectsRef.current = frontObjectsRef.current.filter((o: any) => !rm.has(o))
        backObjectsRef.current = backObjectsRef.current.filter((o: any) => !rm.has(o))
        markDirty() // the removal is a design change even when there's no text to restyle (#autodraft)
      }
      if (willRestyleText) pendingEmbConvertRef.current = true // text re-styled once embroidery config loads
    }
    // Land on a still-visible tool (Upload/Names are hidden in embroidery).
    if (m === 'embroidery' && HIDDEN_FOR_EMBROIDERY.includes(activeTab)) setActiveTab('text')

    canvas?.discardActiveObject(); canvas?.renderAll()
    setLowResWarning(null)
    setPrintMethod(m)
  }

  // Mobile band tab tap: switch tool AND open the band; tapping the ALREADY-active
  // tab closes it (back to just the icon strip, shirt at full size).
  const bandSelectTab = (tab: 'text' | 'upload' | 'clipart' | 'names' | 'layers') => {
    if (bandOpen && activeTab === tab) { setBandOpen(false); return }
    handleSelectTab(tab)
    setBandOpen(true)
  }

  // Clear All — one shared handler for desktop (in-stage) and mobile (the ☰ menu),
  // so both give the same clean slate: discard selection, empty the canvas, collapse
  // the mobile band. The canvas going empty re-shows the "Let's build it" greeting on
  // both layouts (canvasObjectCount → 0). setBandOpen is a no-op on desktop.
  const handleClearAll = () => {
    if (!confirm('Clear all design elements?')) return
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    canvas.discardActiveObject()
    canvas.clear()
    canvas.renderAll()
    clearAutodraft()
    setBandOpen(false)
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
      lineHeight: lineHeight,
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
      setSelectedObjectType(null); setLowResWarning(null)
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

  // D2 "Use on another product": re-open the saved design on a DIFFERENT garment and re-fit it.
  // Unlike openSavedDesign (which uses ?restore= → the draft path with no frozen print box), this
  // goes through ?design_id= → the design_orders row, which carries print_area_front/back — the
  // source box the re-fit projects FROM. product_id/title are the TARGET's; the target's variant +
  // price load from getProduct. refit=1 flips DesignerCanvas into the re-fit restore branch.
  const openSavedOnProduct = (d: SavedDesign, target: TemplateProduct) => {
    const bare = target.shopify_product_id.split('/').pop() || ''
    const params = new URLSearchParams()
    params.set('product_id', bare)
    params.set('design_id', d.designId)
    params.set('title', target.name)
    params.set('refit', '1')
    // Carry the design's color so the target lands on it when offered (else its first color).
    if (d.color) params.set('color', d.color)
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
      // Same vector guard as a fresh upload — a re-added SVG must not draw a false low-res warning.
      if (item.fileType === 'image/svg+xml' || item.url.toLowerCase().split('?')[0].endsWith('.svg')) {
        (img as any)._isVectorUpload = true
      }
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

    // Reject oversize BEFORE any upload attempt. Cloudinary rejects files over the plan
    // cap (MAX_UPLOAD_MB); that failure used to be silent (esp. PDFs — preview kept,
    // original lost). A clear message + the email valve means the customer knows
    // immediately and we never store an absent/damaged original.
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      alert(
        `That file is ${mb} MB, but the largest we can upload here is ${MAX_UPLOAD_MB} MB.\n\n` +
        `Please upload a smaller version — or email the original file to us at ${SUPPORT_EMAIL} ` +
        `and we'll add it to your order.`,
      )
      e.target.value = ''
      return
    }

    markDirty()

    const ext = file.name.split('.').pop()?.toLowerCase() || ''

    // EPS is dropped from supported formats: Cloudinary disabled EPS transformation platform-wide
    // (security), so f_png would fail regardless of plan. Not advertised; if one still slips in
    // (e.g. drag-dropped), send the customer to the email valve instead of a broken upload.
    if (ext === 'eps') {
      alert(`We can't process EPS files here — please email the file to us at ${SUPPORT_EMAIL} and we'll add it to your order.`)
      return
    }
    const cloudinaryFormats = ['ai', 'psd']

    // AI, PSD — upload to Cloudinary which converts them to PNG (a real wait -> show the spinner)
    if (cloudinaryFormats.includes(ext)) {
      setImageEditBusy(true)
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
        alert(`We couldn't process your ${ext.toUpperCase()} file: ${err.message}\n\nPlease try a different file, or email the original to us at ${SUPPORT_EMAIL} and we'll add it to your order.`)
      } finally {
        setImageEditBusy(false)
      }
      e.target.value = ''
      return
    }

    // PDF - rasterize first page using PDF.js (a wait -> spinner)
    if (ext === 'pdf') {
      setImageEditBusy(true)
      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdfjsLib = await import('pdfjs-dist')
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const pageCount = pdf.numPages
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
        // Never silently drop the original or hide the page loss — tell the customer now.
        const notices: string[] = []
        if (pageCount > 1) notices.push(`Your PDF has ${pageCount} pages — only page 1 was added to the design. If you need a different page, please upload just that page.`)
        if (uploaded && !original) notices.push(`We added your design, but couldn't save the original PDF at full quality for production. Please email the original to us at ${SUPPORT_EMAIL} and we'll attach it to your order.`)
        if (!uploaded) notices.push(`We couldn't save your PDF upload — please try again, or email the file to us at ${SUPPORT_EMAIL}.`)
        if (notices.length) alert(notices.join('\n\n'))
      } catch (err) {
        alert('Could not load PDF. Make sure it is a valid PDF file.')
      } finally {
        setImageEditBusy(false)
      }
      e.target.value = ''
      return
    }

    // SVG, PNG, JPEG, JPG, WEBP - direct load
    const isVector = ext === 'svg' || file.type === 'image/svg+xml'
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      const { FabricImage } = await import('fabric')
      const img = await FabricImage.fromURL(dataUrl)
      // An uploaded SVG is VECTOR — never judge it as low-resolution (it's a raster FabricImage but
      // prints crisp at any size). Flagged separately from clipart's `_isSvg` so it stays in the Upload
      // section (routing keys off _isSvg) but is skipped by the low-res check on both client and bench.
      if (isVector) (img as any)._isVectorUpload = true
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

  // Desktop drag-and-drop onto the dropzone. Without preventDefault the browser opens the dropped
  // file in a new tab (its default) instead of uploading. Reuse handleImageUpload via a synthetic
  // event carrying the dropped files, so all format branches + the size check apply identically.
  const handleImageDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer?.files
    if (!files?.length) return
    await handleImageUpload({ target: { files, value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
  }

  const placeImageOnCanvas = async (img: any, canvas: any) => {
    const canvasEl = canvasRef.current
    const overlay = document.querySelector('[data-print-area]') as HTMLElement
    let spawnX = 340
    let spawnY = 425
    let maxW = CANVAS_W * 0.5, maxH = CANVAS_H * 0.5
    if (overlay && canvasEl) {
      const canvasRect = canvasEl.getBoundingClientRect()
      const overlayRect = overlay.getBoundingClientRect()
      const scaleX = CANVAS_W / canvasRect.width
      const scaleY = CANVAS_H / canvasRect.height
      spawnX = ((overlayRect.left - canvasRect.left) * scaleX) + (overlayRect.width * scaleX / 2)
      spawnY = ((overlayRect.top - canvasRect.top) * scaleY) + (overlayRect.height * scaleY / 2)
      maxW = overlayRect.width * scaleX * 0.8
      maxH = overlayRect.height * scaleY * 0.8
    }
    // Scale-to-fit the print area in BOTH dimensions (shrink only, never enlarge). Uses the best
    // available intrinsic size — falling back to the underlying element's natural size — so a large
    // SVG (whose Fabric width can be 0/unreliable at load) is still fit instead of dropped in huge.
    const el = img._element || (img.getElement && img.getElement())
    const iw = img.width || el?.naturalWidth || el?.width || 0
    const ih = img.height || el?.naturalHeight || el?.height || 0
    if (iw > 0 && ih > 0) {
      const fit = Math.min(maxW / iw, maxH / ih, 1)
      if (fit < 1) img.scale(fit)
    }
    img.set({ left: spawnX, top: spawnY, originX: 'center', originY: 'center' })
    canvas.add(img)
    // Belt-and-suspenders: if it STILL renders larger than the box (odd SVG intrinsic sizing),
    // measure the actual rendered size and shrink to fit — nothing is ever placed un-grabbable.
    const sw = (img.getScaledWidth && img.getScaledWidth()) || 0
    const sh = (img.getScaledHeight && img.getScaledHeight()) || 0
    if (sw > maxW || sh > maxH) {
      const fit = Math.min(maxW / (sw || maxW), maxH / (sh || maxH))
      if (fit < 1 && isFinite(fit)) img.scale((img.scaleX || 1) * fit)
    }
    img.setCoords?.()
    canvas.setActiveObject(img)
    lastActiveObjectRef.current = img
    _activeObj = img
    canvas.renderAll()
  }

  // ── Upload-image editing: Remove White / Remove a Color (Phase 5) ──────────────
  // Keep a re-hosted raw's TRUE format (fixes a JPG that got named .png in the bundle).
  const guessExt = (type?: string, name?: string) => {
    const t = (type || '').toLowerCase()
    if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
    if (t.includes('png')) return 'png'
    if (t.includes('webp')) return 'webp'
    const m = (name || '').match(/\.([a-z0-9]+)$/i)
    return m ? m[1].toLowerCase() : 'png'
  }

  // A single image-edit STATE (undo/redo restores these). Position is captured too, because CROP
  // changes the object's size + position — undo must put it back exactly.
  type EditState = { src: string; uploadSrc?: string; entry?: any; left?: number; top?: number; scaleX?: number; scaleY?: number; angle?: number }
  const snapshotState = (img: any, src: string, uploadSrc?: string, entry?: any): EditState =>
    ({ src, uploadSrc, entry, left: img.left, top: img.top, scaleX: img.scaleX, scaleY: img.scaleY, angle: img.angle })

  // Apply an image-edit STATE (used by undo, redo): swap the object to that src + restore its
  // _uploadSrc, uploaded_files entry, and position/scale. No re-upload — the url is already hosted.
  const applyImageEditState = async (img: any, state: EditState) => {
    const curSrc = img._uploadSrc
    await img.setSrc(state.src)
    img.set({ left: state.left, top: state.top, scaleX: state.scaleX, scaleY: state.scaleY, angle: state.angle })
    img.setCoords?.(); fabricCanvas?.renderAll()
    img._uploadSrc = state.uploadSrc
    const list = uploadedFilesRef.current
    const idx = list.findIndex(f => f.url === curSrc)
    if (state.entry) { if (idx >= 0) list[idx] = { ...state.entry }; else list.push({ ...state.entry }) }
    uploadedFilesRef.current = [...list]
    markDirty(); setEditHistTick(t => t + 1)
  }

  // Commit an edit: swap to the edited (transparent) PNG, re-upload it so a FETCHABLE revised url
  // persists to the bundle + auto-tracer, record url=revised / originalUrl=raw, and push an UNDO
  // step. Edits STACK — originalUrl always keeps the FIRST raw upload. Edited images are NOT added
  // to the My Uploads library (that's for source uploads; an edit is a per-design derivative).
  // editedSrc may be a data URL (client pixel edit -> we re-host it) OR an already-hosted http URL
  // (e.g. the Remove Background cutout, re-hosted server-side -> use directly, no re-upload).
  const applyEditedImage = async (img: any, editedSrc: string, pos?: { left: number; top: number }, opts?: { preserveSize?: boolean }) => {
    const oldSrc: string | undefined = img._uploadSrc
    setImageEditBusy(true)
    try {
      const preEntry = uploadedFilesRef.current.find(f => f.url === oldSrc)
      if (!img._editHist) { // seed history with the PRE-edit state (captured BEFORE anything changes)
        img._editHist = [snapshotState(img, img.getSrc?.() ?? img._element?.src ?? oldSrc, oldSrc, preEntry ? { ...preEntry } : undefined)]
        img._editIdx = 0
      }
      // Remove Background returns a cutout at a DIFFERENT pixel size than the original (remove.bg
      // output res / Cloudinary re-host), so setSrc would resize it on the shirt. Preserve the
      // on-shirt WIDTH (uniform scale, aspect kept). Crop deliberately keeps scale + repositions.
      const prevScaledW = opts?.preserveSize ? (img.getScaledWidth?.() || 0) : 0
      const isData = editedSrc.startsWith('data:')
      await img.setSrc(editedSrc, isData ? undefined : { crossOrigin: 'anonymous' }) // CORS so later edits can read pixels
      if (opts?.preserveSize && prevScaledW && img.width) { const s = prevScaledW / img.width; img.scaleX = s; img.scaleY = s }
      if (pos) img.set({ left: pos.left, top: pos.top }) // crop repositions so content stays put
      img.setCoords?.(); fabricCanvas?.renderAll(); markDirty()
      let revisedUrl: string
      if (isData) {
        const blob = await (await fetch(editedSrc)).blob()
        const uploaded = await uploadToCloudinary(blob)
        revisedUrl = uploaded?.url || editedSrc
      } else {
        revisedUrl = editedSrc // already hosted (server re-hosted the cutout) — no re-upload
      }
      img._uploadSrc = revisedUrl
      const list = uploadedFilesRef.current
      const idx = list.findIndex(f => f.url === oldSrc)
      let entry: any
      if (idx >= 0) {
        const prev = list[idx]
        entry = { ...prev, url: revisedUrl, originalUrl: prev.originalUrl || oldSrc, originalFormat: prev.originalFormat || guessExt(prev.type, prev.name), edited: true }
        list[idx] = entry
      } else {
        entry = { name: 'edited-image.png', url: revisedUrl, type: 'image/png', originalUrl: oldSrc, originalFormat: 'png', edited: true }
        list.push(entry)
      }
      uploadedFilesRef.current = [...list]
      img._editHist = img._editHist.slice(0, img._editIdx + 1) // drop any redo tail
      img._editHist.push(snapshotState(img, editedSrc, revisedUrl, { ...entry }))
      img._editIdx = img._editHist.length - 1
      setEditHistTick(t => t + 1)
    } catch {
      alert("We couldn't edit this image — it may be blocked by the source server. Try re-uploading it, then edit.")
    } finally {
      setImageEditBusy(false)
    }
  }

  const undoImageEdit = async () => {
    const img: any = fabricCanvas?.getActiveObject()
    if (!img?._editHist || img._editIdx <= 0) return
    img._editIdx -= 1
    await applyImageEditState(img, img._editHist[img._editIdx])
  }
  const redoImageEdit = async () => {
    const img: any = fabricCanvas?.getActiveObject()
    if (!img?._editHist || img._editIdx >= img._editHist.length - 1) return
    img._editIdx += 1
    await applyImageEditState(img, img._editHist[img._editIdx])
  }

  // Remove White — one tap, edge-flood so white INSIDE the logo survives.
  const removeWhiteFromSelected = async () => {
    const img: any = fabricCanvas?.getActiveObject()
    if (!img || String(img.type).toLowerCase() !== 'image') return
    let imgData: ImageData | null = null
    try { imgData = elementToImageData(img.getElement()) } catch { alert("We couldn't read this image (it may be blocked by the source server). Try re-uploading it."); return }
    if (!imgData) return
    knockoutWhiteFromEdges(imgData.data, imgData.width, imgData.height, 40)
    await applyEditedImage(img, imageDataToPngDataUrl(imgData))
  }

  // Remove Background — AI auto removal via the server proxy (remove.bg). For photos/complex art
  // where a color-knockout won't do. Persists the transparent result like every other edit.
  const removeBackgroundFromSelected = async () => {
    const img: any = fabricCanvas?.getActiveObject()
    if (!img || String(img.type).toLowerCase() !== 'image') return
    // Send the image's HOSTED Cloudinary URL — remove.bg fetches it itself. Never ship the bytes:
    // Vercel caps this function's request+response at ~4.5MB and any real phone photo exceeds it.
    const src = String(img._uploadSrc || '')
    if (!/^https?:\/\//.test(src)) { alert('Please wait a moment for the upload to finish (or re-upload the image), then try Remove Background again.'); return }
    setImageEditBusy(true)
    try {
      const res = await fetch('/api/remove-bg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: src }) })
      const ct = res.headers.get('content-type') || ''
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let msg = ''
        try { msg = JSON.parse(text)?.error || '' } catch { /* not JSON */ }
        alert(msg || `Background removal failed (HTTP ${res.status}).${text ? ` — ${text.slice(0, 140)}` : ''}`)
        return
      }
      if (ct.includes('application/json')) {
        const data = await res.json().catch(() => ({} as { url?: string }))
        if (!data?.url) { alert('Background removal returned no image.'); return }
        await applyEditedImage(img, data.url, undefined, { preserveSize: true }) // cutout already re-hosted on Cloudinary; keep on-shirt size
      } else if (ct.includes('image')) {
        const blob = await res.blob()
        const resultUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader(); fr.onload = () => resolve(fr.result as string); fr.onerror = () => reject(new Error('read failed')); fr.readAsDataURL(blob)
        })
        await applyEditedImage(img, resultUrl, undefined, { preserveSize: true })
      } else {
        const text = await res.text().catch(() => '')
        alert(`Background removal returned an unexpected response.${text ? ` — ${text.slice(0, 140)}` : ''}`)
      }
    } catch (e: any) {
      alert(`Background removal error: ${e?.message || e}`)
    } finally { setImageEditBusy(false) }
  }

  // Recompute the color-removal PREVIEW from the cached ORIGINAL pixels at the current tolerance.
  const previewColorRemoval = (ref: NonNullable<typeof colorPreviewRef.current>, tol: number): string => {
    const copy = new ImageData(new Uint8ClampedArray(ref.original.data), ref.original.width, ref.original.height)
    knockoutColorGlobal(copy.data, ref.pickedColor, tol)
    return imageDataToPngDataUrl(copy)
  }

  // Remove a Color — eyedropper: while active, the next canvas click samples the pixel under the
  // cursor and enters LIVE PREVIEW (the tolerance slider re-previews; Apply/Cancel commits). The
  // handler is registered only while active. The cursor becomes an eyedropper while armed.
  useEffect(() => {
    if (!fabricCanvas || !eyedropperActive) return
    const prevCursor = fabricCanvas.defaultCursor, prevHover = fabricCanvas.hoverCursor
    const eyeSvg = "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3'><path d='m2 22 1-1h3l9-9'/><path d='M3 21v-3l9-9'/><path d='m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z'/></svg>"
    const eye = `url("data:image/svg+xml,${encodeURIComponent(eyeSvg)}") 1 22, crosshair`
    fabricCanvas.defaultCursor = eye; fabricCanvas.hoverCursor = eye
    let cancelled = false
    const onDown = async (opt: any) => {
      const img: any = fabricCanvas.getActiveObject()
      if (!img || String(img.type).toLowerCase() !== 'image') { setEyedropperActive(false); return }
      let util: any
      try { util = (await import('fabric')).util } catch { return }
      if (cancelled) return
      const pointer = fabricCanvas.getScenePoint(opt.e)
      const local = util.transformPoint(pointer, util.invertTransform(img.calcTransformMatrix()))
      const nx = local.x + img.width / 2, ny = local.y + img.height / 2 // -> natural pixel coords
      let original: ImageData | null = null
      try { original = elementToImageData(img.getElement()) } catch { alert("We couldn't read this image (it may be blocked by the source server). Try re-uploading it."); setEyedropperActive(false); return }
      if (!original) { setEyedropperActive(false); return }
      colorPreviewRef.current = { obj: img, original, originalSrc: img.getSrc?.() ?? img._element?.src ?? '', pickedColor: sampleColorAt(original, nx, ny) }
      setEyedropperActive(false)
      setColorPreview(true) // the preview effect below renders it (and re-renders on tolerance)
    }
    fabricCanvas.on('mouse:down', onDown)
    return () => { cancelled = true; fabricCanvas.off('mouse:down', onDown); fabricCanvas.defaultCursor = prevCursor; fabricCanvas.hoverCursor = prevHover }
  }, [fabricCanvas, eyedropperActive, removeColorTol])

  // Live re-preview as the tolerance slider moves (only while previewing a color removal).
  useEffect(() => {
    if (!colorPreview || !colorPreviewRef.current) return
    const ref = colorPreviewRef.current
    ref.obj.setSrc(previewColorRemoval(ref, removeColorTol)).then(() => fabricCanvas?.renderAll())
  }, [removeColorTol, colorPreview])

  const applyColorRemoval = async () => {
    const ref = colorPreviewRef.current
    if (!ref) return
    const url = previewColorRemoval(ref, removeColorTol)
    setColorPreview(false); colorPreviewRef.current = null
    await applyEditedImage(ref.obj, url)
  }
  const cancelColorRemoval = async () => {
    const ref = colorPreviewRef.current
    if (!ref) return
    if (ref.originalSrc) { await ref.obj.setSrc(ref.originalSrc); fabricCanvas?.renderAll() }
    setColorPreview(false); colorPreviewRef.current = null
  }

  // Manual crop — a draggable rectangle over the selected image; Apply keeps what's inside it.
  const startCrop = async () => {
    const img: any = fabricCanvas?.getActiveObject()
    if (!img || String(img.type).toLowerCase() !== 'image') return
    const { Rect } = await import('fabric')
    // Snap the crop box to the image's bounds using the image's OWN scene coords (center-origin
    // upload) — the placement that worked before. Transparent fill + visible dashed outline so the
    // kept region reads bright once the outside is dimmed.
    const w = img.width * (img.scaleX || 1), h = img.height * (img.scaleY || 1)
    const bx0 = img.left - w / 2, by0 = img.top - h / 2
    const rect: any = new Rect({
      left: bx0, top: by0, originX: 'left', originY: 'top', width: w, height: h, angle: 0,
      fill: 'transparent', stroke: '#ffffff', strokeDashArray: [6, 4], strokeWidth: 2, strokeUniform: true,
      cornerColor: '#ffffff', cornerStrokeColor: '#111111', cornerSize: 16, cornerStyle: 'rect',
      transparentCorners: false, hasBorders: false, lockRotation: true, objectCaching: false, excludeFromExport: true,
    })
    // EDGE handles only (drop corners + rotation) — Fabric's DEFAULT controls, no custom render, so
    // the render can't be corrupted the way the bar-controls broke it. Grabbable 16px edge grips.
    rect.setControlsVisibility?.({ tl: false, tr: false, bl: false, br: false, mtr: false })
    rect._isCropRect = true

    // Dim everything OUTSIDE the box (the "this is a crop" signal): four scrims following the box.
    const mkScrim = () => new Rect({ originX: 'left', originY: 'top', fill: 'rgba(0,0,0,0.5)', selectable: false, evented: false, excludeFromExport: true, objectCaching: false })
    const scrims = [mkScrim(), mkScrim(), mkScrim(), mkScrim()]
    const sync = () => {
      const x = rect.left, y = rect.top, ww = rect.width * (rect.scaleX || 1), hh = rect.height * (rect.scaleY || 1)
      scrims[0].set({ left: 0, top: 0, width: CANVAS_W, height: Math.max(0, y) })                       // top
      scrims[1].set({ left: 0, top: y + hh, width: CANVAS_W, height: Math.max(0, CANVAS_H - (y + hh)) }) // bottom
      scrims[2].set({ left: 0, top: y, width: Math.max(0, x), height: Math.max(0, hh) })                // left
      scrims[3].set({ left: x + ww, top: y, width: Math.max(0, CANVAS_W - (x + ww)), height: Math.max(0, hh) }) // right
      scrims.forEach(s => s.setCoords?.())
    }
    // CONSTRAIN the box to the image — it can never leave (nothing meaningful to crop outside it).
    const clamp = () => {
      let rw = rect.width * (rect.scaleX || 1), rh = rect.height * (rect.scaleY || 1)
      if (rw > w) { rect.scaleX = w / rect.width; rw = w }         // never larger than the image
      if (rh > h) { rect.scaleY = h / rect.height; rh = h }
      if (rect.left < bx0) rect.left = bx0                          // keep inside the image bounds
      if (rect.top < by0) rect.top = by0
      if (rect.left + rw > bx0 + w) rect.left = bx0 + w - rw
      if (rect.top + rh > by0 + h) rect.top = by0 + h - rh
      rect.setCoords?.()
    }
    sync()
    img.selectable = false; img.evented = false
    scrims.forEach(s => fabricCanvas.add(s)) // below the rect
    fabricCanvas.add(rect); fabricCanvas.setActiveObject(rect)
    rect.on('moving', () => { clamp(); sync(); fabricCanvas.requestRenderAll() })
    rect.on('scaling', () => { clamp(); sync(); fabricCanvas.requestRenderAll() })
    fabricCanvas.renderAll()
    cropRectRef.current = { rect, img, scrims, sync }
    setCropMode(true)
  }
  const cleanupCrop = () => {
    const cr = cropRectRef.current
    if (!cr) return
    try {
      cr.rect.off?.('moving'); cr.rect.off?.('scaling')
      fabricCanvas?.remove(cr.rect)
      cr.scrims?.forEach(s => fabricCanvas?.remove(s))
    } catch { /* already gone */ }
    cr.img.selectable = true; cr.img.evented = true
    fabricCanvas?.setActiveObject(cr.img); fabricCanvas?.renderAll()
    cropRectRef.current = null; setCropMode(false)
  }
  const applyCrop = async () => {
    const cr = cropRectRef.current
    if (!cr) return
    const { rect, img } = cr
    const { util } = await import('fabric')
    const W = img.width, H = img.height
    const inv = util.invertTransform(img.calcTransformMatrix())
    // Rect scene corners from its OWN coords (left/top origin, angle 0) — same space as the image
    // matrix, so mapping to natural pixels is exact (the proven eyedropper mapping).
    const rw = rect.width * (rect.scaleX || 1), rh = rect.height * (rect.scaleY || 1)
    const p0 = util.transformPoint({ x: rect.left, y: rect.top }, inv)
    const p1 = util.transformPoint({ x: rect.left + rw, y: rect.top + rh }, inv)
    const nx0 = Math.max(0, Math.min(p0.x, p1.x) + W / 2)
    const ny0 = Math.max(0, Math.min(p0.y, p1.y) + H / 2)
    const nx1 = Math.min(W, Math.max(p0.x, p1.x) + W / 2)
    const ny1 = Math.min(H, Math.max(p0.y, p1.y) + H / 2)
    const nw = nx1 - nx0, nh = ny1 - ny0
    cleanupCrop() // ALWAYS restore the image + remove the overlay first, so no path leaves a bad state
    // Belt-and-suspenders: empty/degenerate intersection (or a no-op full-image crop) -> cancel
    // cleanly, never edit, never corrupt. try/catch so a bad extraction can't poison the session.
    if (!(nw >= 2 && nh >= 2) || (nw >= W - 1 && nh >= H - 1)) return
    try {
      const center = util.transformPoint({ x: nx0 + nw / 2 - W / 2, y: ny0 + nh / 2 - H / 2 }, img.calcTransformMatrix())
      await applyEditedImage(img, cropToDataUrl(img.getElement(), nx0, ny0, nw, nh), { left: center.x, top: center.y })
    } catch { /* image already restored by cleanupCrop — leave it be */ }
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

      // Decals placed in this design (Designs section). Same _stamp technique as _uploadSrc: walk both
      // sides, dedup by decal number so the same decal on front + back counts once for sell-through.
      // Deleting a decal removes its object, so it drops out for free.
      const decalMap = new Map<number, { number: number; name: string }>()
      ;[...frontObjectsRef.current, ...backObjectsRef.current].forEach((o: any) => {
        if (o?._decalNumber != null && !decalMap.has(o._decalNumber)) {
          decalMap.set(o._decalNumber, { number: o._decalNumber, name: o._decalName || '' })
        }
      })
      const decalsUsed = Array.from(decalMap.values())
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
          // originalUrl rides along so the admin/print shop can reach the vector (or the
          // pristine pre-edit raw) rather than only the flattened rendition. `edited` flags a
          // background/color-removed image so the bundle prints from the REVISED url, not the raw.
          const extra = {
            ...(f.originalUrl ? { originalUrl: f.originalUrl, originalFormat: f.originalFormat } : {}),
            ...(f.edited ? { edited: true } : {}),
          }
          if (!f.url.startsWith('data:')) return { name: f.name, url: f.url, type: f.type, ...extra }
          const blob = await fetch(f.url).then(r => r.blob())
          const url = await uploadToStorage(blob, `${orderId}/uploads/${idx}_${f.name}`, 'customer-uploads')
          return { name: f.name, url: url || f.url, type: f.type, ...extra }
        })
      )

      // Names & Numbers: the roster IS the order's quantity source — each entry is `qty` shirts of
      // its size — so an N&N order's quantities/total derive from the roster, not the size steppers
      // (which the designer hides for N&N). The personalization price is Option 1: it's the printed
      // side, already in the per-side print charge, so pricePerItem is unchanged — nothing added.
      const nnEntries = roster.filter(entryHasContent)
      const nnActive = nnEntries.length > 0
      const effQuantities = nnActive ? rosterSizeQuantities(nnEntries) : quantities
      const effTotalQty = nnActive ? rosterShirtCount(nnEntries) : totalQty
      const effTotalPrice = effTotalQty * pricePerItem

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
        quantities: effQuantities,
        // Names & Numbers roster (Option 1 pricing: no separate fee). Only sent for N&N designs so a
        // plain order never touches the new column. Content entries only.
        ...(nnActive ? { roster: nnEntries } : {}),
        // Decals used (Designs section). Only sent when decals were placed, so a plain order never
        // touches the column. List of { number, name } for sell-through reporting.
        ...(decalsUsed.length > 0 ? { decals_used: decalsUsed } : {}),
        // Real sizes available for the selected color, in Shopify variant order.
        available_sizes: (productSizes.length ? productSizes : SIZES).filter(s => isSizeAvailable(s)),
        unit_price: unitPrice,
        print_charge: printCharge,
        // Per-side split (Day 4). Null when that side has no content, so the
        // order page / fulfillment can tell "designed but $0" from "not designed".
        print_charge_front: frontHasContent ? frontCharge : null,
        print_charge_back: backHasContent ? backCharge : null,
        price_per_item: pricePerItem,
        total_qty: effTotalQty,
        total_price: parseFloat(effTotalPrice.toFixed(2)),
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
  // Keep the mobile delete-control's handler pointing at the live deleteSelected.
  useEffect(() => { deleteSelectedRef.current = deleteSelected })

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
  // it; the "Let's build it" greeting whenever that blank side is the FRONT. It used
  // to also require the BACK to be empty ("fully-blank first impression"), but the
  // back fills in ASYNC on a restore/port — so a back-stack N&N design opened on the
  // blank front flashed the greeting, then dropped it the instant backObjectsRef
  // populated (buttons visibly changing while the view stayed on front, Denise
  // 2026-08-06). Keying only on the current side keeps the front CTAs STABLE until
  // the customer actually flips to Back. Add Text focuses the box (discoverability).
  const emptyState = canvasObjectCount === 0 ? {
    showGreeting: shirtView === 'front',
    // A CTA selects the tool and OPENS the mobile band (no-op on desktop); Add Text
    // also focuses the box once the band has mounted it.
    onAddText: () => { setActiveTab('text'); setBandOpen(true); setTimeout(() => textInputRef.current?.focus(), 0) },
    // Upload isn't offered in embroidery (same rule as the rail's HIDDEN_FOR_EMBROIDERY) — omit the
    // greeting's Upload CTA so it can't confuse customers with an option that does nothing there.
    onUpload: printMethod === 'embroidery' ? undefined : () => { setActiveTab('upload'); setBandOpen(true) },
    onAddArt: () => { setActiveTab('clipart'); setBandOpen(true) },
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
    // A save must never capture a preview substitution — restore the sample placeholders first. The
    // auto-draft writer skips entirely during preview (nnPreviewRef guard below), so in practice this
    // only fires on an explicit save/Next-Step while previewing, where exiting preview is correct UX.
    if (nnPreviewRef.current !== null) exitNnPreview()
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
      roster, // Phase 1: carried by the auto-draft snapshot; DB column lands in Phase 2
      // Freeze the print-area box this design was made against, so a saved design carries its OWN
      // source box (D2 re-fits FROM it on "Use on another product"). Same refs the order path stamps.
      templateId: templateIdRef.current ?? undefined,
      printAreaFrontId: printAreaFrontIdRef.current ?? undefined,
      printAreaBackId: printAreaBackIdRef.current ?? undefined,
      printAreaFront: printAreaFrontSnapRef.current ?? undefined,
      printAreaBack: printAreaBackSnapRef.current ?? undefined,
    }
  }

  // Keep the debounced auto-draft writer pointed at the LATEST state (runs every render, so the timer
  // scheduleAutodraft sets always serializes current values).
  useEffect(() => {
    autodraftWriteRef.current = () => {
      if (typeof window === 'undefined') return
      // CRITICAL: never touch storage until the canvas is READY and NOT mid-restore.
      // snapshotDesignState() returns null for BOTH "canvas not ready yet" (fabric loads via async
      // import — can resolve AFTER this debounce on slow mobile) and "genuinely empty". Treating the
      // not-ready case as empty would removeItem and wipe the very snapshot we're about to restore.
      if (!fabricCanvasRef.current || isRestoringRef.current || nnPreviewRef.current !== null) return
      try {
        const state = snapshotDesignState()
        // ONLY WRITE, never remove: removal is explicit (Clear All / fresh-nav), so a transiently-
        // empty or not-yet-loaded canvas can never wipe a snapshot we may still need to restore.
        if (state) sessionStorage.setItem(AUTODRAFT_KEY, JSON.stringify(buildEnvelope(state, Date.now())))
      } catch { /* storage full/disabled — non-fatal */ }
    }
  })

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

  // D2.5 switch-garment mid-design: snapshot the CURRENT draft (its canvas + frozen print box) to a
  // design_orders row, then re-open it on the chosen product through the SAME re-fit path as "Use on
  // another product" (design_id + refit=1 + carried color). "Quick re-open," not a seamless in-place
  // swap (that's a later upgrade). An empty canvas just opens the new product fresh.
  const switchToProduct = async (target: TemplateProduct) => {
    setSwitchOpen(false)
    const bare = target.shopify_product_id.split('/').pop() || ''
    const params = new URLSearchParams()
    params.set('product_id', bare)
    params.set('title', target.name)
    const state = snapshotDesignState()
    if (state) {
      let draftId: string | null = null
      try {
        const res = await fetch('/api/designs/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(state),
        })
        const body = res.ok ? await res.json() : null
        draftId = body?.draftId ?? null
      } catch (err) { console.error('[designer] switch snapshot failed:', err) }
      // If we couldn't snapshot the in-progress design, DON'T navigate away — that would silently lose
      // the customer's work. Keep them on the current garment and let them retry.
      if (!draftId) { alert("Couldn't switch products just now — please try again."); return }
      params.set('design_id', draftId)
      params.set('refit', '1')
      if (selectedColor) params.set('color', selectedColor)
    }
    window.location.href = `/designer?${params.toString()}`
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

  const handleClipartSelect = (url: string, fileType: string, meta?: { decal?: { number: number; name: string }; supportedMethods?: string[] }) => {
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
        // Which methods this art supports — so a Print↔Embroidery switch keeps it if it's valid there.
        if (meta?.supportedMethods) (img as any)._supportedMethods = meta.supportedMethods
        // Decal stamp: freeze the number + name onto the object so the order can record which
        // decals were placed (collected at save). Only present for art that carries a Decal #.
        if (meta?.decal) {
          ;(img as any)._decalNumber = meta.decal.number
          ;(img as any)._decalName = meta.decal.name
        }
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
  const textProps = { textInput, textInputRef, handleTextInputChange, selectedObjectType, startNewText, dbFonts, fonts, selectedFont, setSelectedFont, selectedTextPreview, fontSize, setFontSize, letterSpacing, setLetterSpacing, lineHeight, setLineHeight, textColor, setTextColor, textDirection, setTextDirection, curveAmount, setCurveAmount, textIsMultiline, textAlign, handleTextAlign, isBold, setIsBold, isItalic, setIsItalic, isUppercase, setIsUppercase }
  // ── Layers ──────────────────────────────────────────────────────────────────
  // A per-side list of everything on the shirt (FRONT-most first) for the Layers tool. Recomputed each
  // render from the live canvas; re-renders are driven by layersTick (reorder + selection), the
  // selection state, canvasObjectCount (add/remove), and shirtView (side). N&N placeholders collapse
  // into ONE locked row. layersTick is a re-render nonce (a reorder/selection changes neither the object
  // count nor fires an add/removed event); read here so it isn't flagged unused.
  void layersTick
  const layerKind = (o: any): LayerKind => {
    if (o.type === 'i-text' || o.type === 'textbox' || o._isCurvedText) return 'text'
    if (typeof o._isSvg === 'boolean') return 'art' // library art (SVG or raster clipart / decal)
    return 'image' // customer upload
  }
  const layerLabel = (o: any, kind: LayerKind): string => {
    if (kind === 'text') {
      const t = String(o._originalText ?? o.text ?? '').replace(/\s+/g, ' ').trim()
      return t || 'Text'
    }
    if (o._decalName) return String(o._decalName)
    if (o._uploadSrc) {
      try {
        const base = decodeURIComponent(String(o._uploadSrc).split('?')[0].split('/').pop() || '')
        if (base) return base
      } catch { /* fall through to generic */ }
      return 'Upload'
    }
    return kind === 'art' ? 'Art' : 'Image'
  }
  const layerObjById = (id: string): any =>
    fabricCanvasRef.current?.getObjects().find((o: any) => o._layerId === id) || null
  const buildLayerRows = (): LayerRow[] => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return []
    const objs = canvas.getObjects().filter((o: any) => o && !o._isCropRect && !o.excludeFromExport)
    const active = canvas.getActiveObject()
    const rows: LayerRow[] = []
    let nnPushed = false
    for (let i = objs.length - 1; i >= 0; i--) { // last object = front-most → top of the list
      const o: any = objs[i]
      if (o[NN_ROLE_PROP]) {
        if (!nnPushed) {
          nnPushed = true
          rows.push({ id: NN_ROW_ID, kind: 'nn', label: 'Names & Numbers', selected: !!(active && active[NN_ROLE_PROP]) })
        }
        continue // collapse the whole N&N stack into one row
      }
      if (!o._layerId) o._layerId = `L${++_layerSeq}`
      const kind = layerKind(o)
      rows.push({ id: o._layerId, kind, label: layerLabel(o, kind), selected: o === active })
    }
    return rows
  }
  const layerRows = buildLayerRows()
  const onLayerSelect = (id: string) => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return
    if (id === NN_ROW_ID) {
      const nn = canvas.getObjects().find((o: any) => o[NN_ROLE_PROP])
      if (nn) { canvas.setActiveObject(nn); canvas.renderAll() } // routes to Names via sectionForObject
      else setActiveTab('names')
      return
    }
    const obj = layerObjById(id)
    if (!obj) return
    selectingFromLayersRef.current = true // stay on the Layers tab (skip the auto tab-switch)
    canvas.setActiveObject(obj)
    canvas.renderAll()
    selectingFromLayersRef.current = false
    setLayersTick(t => t + 1) // refresh the selected-row highlight (same-type selects don't move state)
  }
  const onLayerMove = (id: string, dir: 'up' | 'down') => {
    const canvas = fabricCanvasRef.current
    if (!canvas || id === NN_ROW_ID) return
    const obj = layerObjById(id)
    if (!obj) return
    if (dir === 'up') canvas.bringObjectForward(obj) // toward the front
    else canvas.sendObjectBackwards(obj)             // toward the back
    canvas.renderAll()
    markDirty()
    setLayersTick(t => t + 1) // a pure reorder fires no add/removed event — nudge the list
  }
  const onLayerDelete = (id: string) => {
    const canvas = fabricCanvasRef.current
    if (!canvas || id === NN_ROW_ID) return
    const obj = layerObjById(id)
    if (!obj) return
    canvas.remove(obj)
    canvas.discardActiveObject()
    canvas.renderAll()
    markDirty() // object:removed → canvasObjectCount → re-render
  }
  const layersPanel = (
    <LayersPanel rows={layerRows} onSelect={onLayerSelect} onMove={onLayerMove} onDelete={onLayerDelete} />
  )

  const selectionPanel = (
    <SelectionPanel
      activeTab={activeTab}
      dbColors={dbColors}
      deleteSelected={deleteSelected}
      text={textProps}
      upload={{ handleImageUpload, handleImageDrop, uploadGuidance: UPLOAD_GUIDANCE, libraryUploads, libraryLoading, pickLibraryUpload, deleteLibraryUpload, removeWhite: removeWhiteFromSelected, removeBackground: removeBackgroundFromSelected, eyedropperActive, setEyedropperActive, removeColorTol, setRemoveColorTol, imageEditBusy, colorPreview, applyColorRemoval, cancelColorRemoval, startCrop, cropMode, applyCrop, cancelCrop: cleanupCrop, lowResWarning }}
      clipart={{ printMethod, handleClipartSelect, recolorSvg, setSelectedSvgColor, selectedSvgColor }}
    />
  )
  const namesPanel = (
    <NamesNumbersPanel
      roster={roster}
      onChange={r => { setRoster(r); markDirty() }}
      onAddNameField={addNameField}
      onAddNumberField={addNumberField}
      onAddTitleField={addTitleField}
      printReady={!!printArea}
      hasName={nnFields.name}
      hasNumber={nnFields.number}
      hasTitle={nnFields.title}
      sizes={Object.keys(quantities)}
      selectedRole={selectedNnRole}
      preview={{
        canPreview: (nnFields.name || nnFields.number || nnFields.title) && roster.some(entryHasContent),
        entries: roster.filter(entryHasContent),
        index: nnPreviewIndex,
        onStart: enterNnPreview,
        onStep: stepNnPreview,
        onExit: exitNnPreview,
      }}
      style={{
        fonts: dbFonts.length ? dbFonts : fonts,
        selectedFont, setSelectedFont,
        colors: dbColors,
        textColor, setTextColor,
        onDeselect: () => { const c = fabricCanvasRef.current; c?.discardActiveObject(); c?.renderAll() },
      }}
    />
  )
  // Rail tools to hide for THIS product: Upload+Names in embroidery mode, and Names when the product's
  // template turns Names & Numbers off (accessories etc.). Undefined = show everything.
  const railHiddenKeys = (() => {
    const hidden: string[] = []
    if (printMethod === 'embroidery') hidden.push(...HIDDEN_FOR_EMBROIDERY)
    if (!namesNumbersEnabled && !hidden.includes('names')) hidden.push('names')
    return hidden.length ? hidden : undefined
  })()

  // Print/Embroidery segmented control (embroidery mode) — shared by the desktop aside header AND the
  // mobile band so BOTH surfaces can switch method. Only when the product supports >1. Active = quiet
  // dark (red-vocab: red is action-only, never selected-state).
  const methodToggle = supportedMethods.length > 1 ? (
    <div className="flex gap-1.5">
      {supportedMethods.map(m => {
        const active = printMethod === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => handleMethodSwitch(m)}
            aria-pressed={active}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700 hover:border-gray-400'
            }`}
          >
            {methodLabel(m)}
          </button>
        )
      })}
    </div>
  ) : null

  // On mobile every tool gets a purpose-built compact band (horizontal rows), all
  // mobile-only so the desktop vertical SelectionPanel stays untouched.
  const mobileBandContent =
    activeTab === 'text' ? <MobileTextBand text={textProps} dbColors={dbColors} deleteSelected={deleteSelected} alignObject={alignObject} />
    : activeTab === 'upload' ? (
      <MobileUploadBand
        handleImageUpload={handleImageUpload}
        uploadGuidance={UPLOAD_GUIDANCE}
        libraryUploads={libraryUploads}
        libraryLoading={libraryLoading}
        pickLibraryUpload={pickLibraryUpload}
        deleteLibraryUpload={deleteLibraryUpload}
        selectedObjectType={selectedObjectType}
        deleteSelected={deleteSelected}
        alignObject={alignObject}
        removeWhite={removeWhiteFromSelected}
        removeBackground={removeBackgroundFromSelected}
        eyedropperActive={eyedropperActive}
        setEyedropperActive={setEyedropperActive}
        removeColorTol={removeColorTol}
        setRemoveColorTol={setRemoveColorTol}
        imageEditBusy={imageEditBusy}
        colorPreview={colorPreview}
        applyColorRemoval={applyColorRemoval}
        cancelColorRemoval={cancelColorRemoval}
        startCrop={startCrop}
        cropMode={cropMode}
        applyCrop={applyCrop}
        cancelCrop={cleanupCrop}
        lowResWarning={lowResWarning}
      />
    )
    : activeTab === 'clipart' ? (
      <MobileArtBand
        printMethod={printMethod}
        onSelect={handleClipartSelect}
        selectedObjectType={selectedObjectType}
        dbColors={dbColors}
        recolorSvg={recolorSvg}
        selectedSvgColor={selectedSvgColor}
        setSelectedSvgColor={setSelectedSvgColor}
        deleteSelected={deleteSelected}
        alignObject={alignObject}
      />
    )
    : activeTab === 'layers' ? layersPanel
    : activeTab === 'names' ? namesPanel
    : selectionPanel

  // Root is a fixed, app-like viewport: no page scroll / pull-to-refresh on
  // mobile, so touch gestures reach the canvas + sheet instead of the browser.
  // Desktop keeps h-screen exactly (lg:h-screen) — parity-safe; the overflow /
  // overscroll locks are no-ops on desktop. dvh accounts for the mobile URL bar.
  return (
    <div ref={shellRef} className="designer-mobile-shell flex flex-col lg:h-screen lg:overflow-hidden overscroll-none text-gray-900" style={{ fontFamily: 'DM Sans, sans-serif' }}>

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

      {/* (The mobile top align strip was removed — it added a SECOND in-flow row on
          select, shrinking the shirt twice. Align now lives inside each tool's band
          edit controls; Clear All moved to the ☰ menu.) */}

      {/* Main layout. min-h-0 (mobile only) lets this flex row shrink below the shirt's
          intrinsic size so the whole column FITS the screen when the tool band is open —
          otherwise it overflows ~114px, the page becomes scrollable, and the top bar
          scrolls off (the barTop-114 trace). Desktop reverts to auto (byte-identical). */}
      <div className="flex flex-1 overflow-hidden min-h-0 lg:[min-height:auto]">

        {/* Left tool panel — DESKTOP only (mobile uses the bottom sheet below).
            Rendered conditionally (not CSS-hidden) so exactly one SelectionPanel
            is mounted → one textInputRef, one textarea. Desktop uses `flex`
            exactly as before → parity-safe. */}
        {!isMobile && (
          <aside className="w-[400px] bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
            {/* Embroidery mode: Print/Embroidery toggle, only when the product supports BOTH. */}
            {methodToggle && <div className="border-b border-gray-200 p-2 shrink-0">{methodToggle}</div>}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              <Rail activeTab={activeTab} onSelectTab={handleSelectTab} onProducts={() => setSwitchOpen(true)}
                hiddenKeys={railHiddenKeys} />
              <div className="flex-1 min-w-0 overflow-y-auto pt-3">
                {activeTab === 'layers' ? layersPanel : activeTab === 'names' ? namesPanel : selectionPanel}
              </div>
            </div>
          </aside>
        )}

        {/* Canvas center. The tool band sits BELOW this in the mobile column (in
            flow), so the shirt is never covered and can center normally on both
            desktop and mobile — one identical string, byte-for-byte. */}
        <section
          ref={stageAreaRef}
          className="flex-1 flex flex-col items-center justify-center bg-gray-50 relative overflow-hidden touch-none min-h-0 lg:[min-height:auto]">

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-800 text-sm z-10">
              Loading canvas...
            </div>
          )}

          {/* MOBILE top-right cluster — Undo/Redo (image edits) sit BY Clear all (Denise: that's
              where they make sense on the phone). Undo/Redo appear only when the selected image
              has edit history; Clear all whenever there's something to clear. Desktop has its own
              in-stage row (align + undo/redo + Clear All). */}
          {isMobile && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
              {(() => {
                const im: any = editHistTick >= 0 ? fabricCanvas?.getActiveObject() : null
                const canU = !!(im?._editHist && im._editIdx > 0)
                const canR = !!(im?._editHist && im._editIdx < im._editHist.length - 1)
                if (!canU && !canR) return null
                return (
                  <>
                    <button type="button" title="Undo" onClick={undoImageEdit} disabled={!canU || imageEditBusy}
                      className="flex items-center justify-center rounded-full border border-gray-200 bg-white/90 p-2 text-gray-700 shadow-sm backdrop-blur disabled:opacity-40">
                      <Undo2 size={15} strokeWidth={2} />
                    </button>
                    <button type="button" title="Redo" onClick={redoImageEdit} disabled={!canR || imageEditBusy}
                      className="flex items-center justify-center rounded-full border border-gray-200 bg-white/90 p-2 text-gray-700 shadow-sm backdrop-blur disabled:opacity-40">
                      <Redo2 size={15} strokeWidth={2} />
                    </button>
                  </>
                )
              })()}
              {canvasObjectCount > 0 && (
                <button type="button" onClick={handleClearAll}
                  className="rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-xs text-[#dd3333] shadow-sm backdrop-blur">
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Alignment toolbar — DESKTOP only now; on mobile it moves to the slim
              top strip below the header so it stops eating the shirt's space. */}
          {!isMobile && (
          <div className="shrink-0 flex items-center gap-1 mb-2 px-1 flex-wrap">
            {/* Undo/Redo for image editing (Phase 5) — enabled when the selected image has edit
                history. editHistTick forces this to re-evaluate after each edit/undo/redo. */}
            {(() => {
              const im: any = editHistTick >= 0 ? fabricCanvas?.getActiveObject() : null
              const canU = !!(im?._editHist && im._editIdx > 0)
              const canR = !!(im?._editHist && im._editIdx < im._editHist.length - 1)
              return (
                <>
                  <button title="Undo image edit" disabled={!canU || imageEditBusy}
                    onPointerDown={e => { e.preventDefault(); undoImageEdit() }}
                    className="flex items-center justify-center px-2 py-1.5 rounded bg-gray-100 border border-gray-200 text-gray-700 hover:border-[#dd3333] hover:text-gray-900 transition-all disabled:opacity-40 disabled:hover:border-gray-200">
                    <Undo2 size={16} strokeWidth={1.75} />
                  </button>
                  <button title="Redo image edit" disabled={!canR || imageEditBusy}
                    onPointerDown={e => { e.preventDefault(); redoImageEdit() }}
                    className="flex items-center justify-center px-2 py-1.5 rounded bg-gray-100 border border-gray-200 text-gray-700 hover:border-[#dd3333] hover:text-gray-900 transition-all disabled:opacity-40 disabled:hover:border-gray-200">
                    <Redo2 size={16} strokeWidth={1.75} />
                  </button>
                  <span className="w-px h-4 bg-gray-200 mx-1" />
                </>
              )
            })()}
            <span className="text-xs text-gray-800 font-mono uppercase tracking-widest mr-1">Align:</span>
            {[
              { Icon: AlignLeft, title: 'Align Left', fn: 'left' },
              { Icon: AlignCenter, title: 'Align Center', fn: 'center' },
              { Icon: AlignRight, title: 'Align Right', fn: 'right' },
              { Icon: AlignStartHorizontal, title: 'Align Top', fn: 'top' },
              { Icon: AlignCenterHorizontal, title: 'Align Middle', fn: 'middle' },
              { Icon: AlignEndHorizontal, title: 'Align Bottom', fn: 'bottom' },
            ].map(({ Icon, title, fn }) => (
              <button key={fn} title={title}
                onPointerDown={e => {
                  e.preventDefault()
                  alignObject(fn)
                }}
                className="flex items-center justify-center px-2 py-1.5 rounded bg-gray-100 border border-gray-200 text-gray-700 hover:border-[#dd3333] hover:text-gray-900 transition-all">
                <Icon size={16} strokeWidth={1.75} />
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200 mx-1" />
            <button
              title="Clear all objects from canvas"
              onPointerDown={e => { e.preventDefault(); handleClearAll() }}
              className="px-2 py-1 rounded text-xs font-mono bg-gray-100 border border-gray-200 text-red-500 hover:border-red-700 hover:bg-red-900/20 transition-all">
              Clear All
            </button>
          </div>
          )}
          {/* Scale-to-fit wrapper (mobile only). Outer = the SCALED layout box so
            the shirt doesn't overflow; inner keeps the true 680×850 and is CSS
            transform-scaled. On desktop stageScale===1 → outer is 680×850, inner
            has NO transform → identical to rendering <CanvasStage> alone (the flex
            section centers a 680×850 box either way). Parity proves it. */}
        {/* Canvas-centering wrapper (fix): the align row above is shrink-0 and this
            takes the REMAINING space (flex-1) and centers the canvas in it. So the
            align controls are always visible (never clipped by the section's
            overflow), while the canvas stays centered. Its own overflow-hidden keeps
            an over-tall desktop canvas from spilling up over the align row. */}
        <div className="flex w-full min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div style={{ width: 680 * stageScale, height: 850 * stageScale, position: 'relative' }}>
            <div style={{ width: 680, height: 850, transformOrigin: 'top left', transform: stageScale !== 1 ? `scale(${stageScale})` : undefined }}>
              <CanvasStage canvasRef={canvasRef} shirtImgRef={shirtImgRef} printArea={printArea} onReady={handleCanvasReady} emptyState={emptyState} />
            </div>
            {/* "Thinking" overlay for async ops (Remove Background API round-trip, edits + their
                re-upload, converted-file uploads). Silence reads as broken; the spinner reads as
                working. Driven by imageEditBusy. */}
            {imageEditBusy && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/45 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2 rounded-xl bg-white/90 px-5 py-4 shadow-lg">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-300 border-t-[#dd3333]" />
                  <span className="text-xs font-mono text-gray-600">Working…</span>
                </div>
              </div>
            )}
          </div>
        </div>

          {/* Front / Back toggle. The band is below the shirt now (not an overlay),
              so the toggle sits at the bottom of the stage on both platforms —
              one identical string, byte-for-byte. */}
          <div className="absolute bottom-5 flex gap-2">
            <button
              onClick={() => switchView('front')}
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
                onClick={() => switchView('back')}
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
          <h2 className="font-black text-lg tracking-widest">PRODUCT</h2>

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

      {/* Mobile tool band — an IN-FLOW fixed-height band + Rail strip at the bottom
          of the column (never overlays the shirt). Mounted only on mobile, so it
          owns the single SelectionPanel. */}
      {isMobile && (
        <MobileToolBand open={bandOpen} activeTab={activeTab} onSelectTab={bandSelectTab} onProducts={() => setSwitchOpen(true)} hiddenKeys={railHiddenKeys} methodToggle={methodToggle}>
          {mobileBandContent}
        </MobileToolBand>
      )}

      <MyDesignsDrawer
        open={designsOpen}
        designs={savedDesigns}
        loading={designsLoading}
        onClose={() => setDesignsOpen(false)}
        onOpenDesign={openSavedDesign}
        onUseOnProduct={(d) => { setDesignsOpen(false); setPortDesign(d) }}
        onDelete={deleteSavedDesign}
      />

      <ProductPickerModal
        open={!!portDesign}
        onClose={() => setPortDesign(null)}
        excludeProductId={portDesign?.productId ?? null}
        subtitle={portDesign ? `Re-fit "${portDesign.name || portDesign.productTitle || 'your design'}" onto:` : undefined}
        onPick={(target) => { if (portDesign) openSavedOnProduct(portDesign, target) }}
      />

      {/* D2.5 switch-garment: the Products rail opens this on the CURRENT design; picking re-fits it
          onto the new garment (excludes the product you're already on). */}
      <ProductPickerModal
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        excludeProductId={product?.id ?? null}
        subtitle="Switch this design to another garment — it re-fits onto:"
        onPick={(target) => { void switchToProduct(target) }}
      />
    </div>
  )
}
