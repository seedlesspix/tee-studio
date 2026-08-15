// Pure curved-text arc rasterizer — the render half of a "curved text" bake, lifted VERBATIM from the
// designer's curve useEffect so the browser path is byte-for-byte unchanged, but headless-callable
// (no React state, no active object) so D2 Design Portability can re-curve a design on the way onto a
// new garment. Given a string + bake params, it lays each character along an arc (or an admin-drawn
// path), crops to the inked pixels, and returns a PNG data URL + its cropped dimensions. Everything
// Fabric-/DOM-position-related (the FabricImage wrapper + print-area constrain) stays in the designer's
// bakeCurvedArc wrapper.
//
// Canvas comes from a factory so the SAME code runs against the browser DOM canvas in production AND
// node-canvas in tests (the parity guard) — no other behavioral difference.
import { curveArcGeometry } from './curveGeometry'
import { pathTextLayout, type Pt } from './curvePath'

export interface CurveParams {
  // Signed DEGREES of arc the text subtends: sign = up/down, magnitude = how far it wraps.
  // Range −360…360 (±360 = a full circle). This IS the slider value now (was an abstract radius-amount).
  curveAmount: number
  fontSize: number      // canvas-px em
  fontFamily: string
  fill: string
  bold: boolean
  italic: boolean
  charSpacing?: number  // Fabric units (1/1000 em, = letter-spacing slider × 10); default 0
  // Type-on-path (Z-hp): when present, glyphs follow this admin-drawn quadratic (P0..control..P2 in the
  // SAME canvas-px space as fontSize) instead of the degrees arc — curvature belongs to the drawn path,
  // text length only decides how much of it is used (auto-shrink to fit). `curveAmount` is then ignored
  // for geometry (kept as the stored fallback). SHARED with the cut engine so preview and cut can't drift.
  path?: { p0: Pt; control: Pt; p2: Pt }
}

export interface CurvedArcResult { dataUrl: string; width: number; height: number }

// Minimal shape of the canvas + 2d context this uses — satisfied by both the DOM canvas and node-canvas.
export interface ArcCanvas {
  width: number; height: number
  getContext(kind: '2d'): ArcCtx | null
  toDataURL(type: string): string
}
export interface ArcCtx {
  font: string; fillStyle: string; textAlign: string; textBaseline: string
  measureText(t: string): { width: number }
  fillText(t: string, x: number, y: number): void
  save(): void; restore(): void; translate(x: number, y: number): void; rotate(a: number): void
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray | number[] }
  drawImage(img: ArcCanvas, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
}
export type CanvasFactory = (w: number, h: number) => ArcCanvas

// Default factory = the browser DOM canvas (referenced lazily so importing this module is server-safe).
const domCanvas: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c as unknown as ArcCanvas
}

export function renderCurvedArc(rawText: string, p: CurveParams, makeCanvas: CanvasFactory = domCanvas): CurvedArcResult {
  const { curveAmount, fontSize: fSize, fontFamily: cFont, fill: cFill, bold: cBold, italic: cItalic, charSpacing = 0, path } = p
  // Per-glyph gap in px, matching Fabric's charSpacing (1/1000 em) so curved + straight spacing agree.
  const spacingPx = (charSpacing / 1000) * fSize
  // Widths are measured at the FULL font size; the path model scales positions (and the render font) down
  // to fit, so it needs the un-shrunk widths.
  const measureFont = `${cItalic ? 'italic' : 'normal'} ${cBold ? 'bold' : 'normal'} ${fSize}px ${cFont}`
  const tmp = makeCanvas(1, 1)
  const tmpCtx = tmp.getContext('2d')!
  tmpCtx.font = measureFont
  const chars = rawText.split('')
  const charWidths = chars.map((ch) => tmpCtx.measureText(ch).width)

  // Per-glyph placement (glyph CENTER + rotation) in local px, the glyphs IN RENDER ORDER, and the
  // effective font size. Both models feed ONE render loop below (place glyph centered at (cx,cy), rotate
  // by angle) — so preview and cut share the exact same geometry contract.
  let placements: { cx: number; cy: number; angle: number }[]
  let orderedChars: string[]
  let effFontSize: number
  if (path) {
    // PATH model: glyphs follow the drawn quadratic in natural order; auto-shrink if they'd overrun it.
    // The drawn bulge direction IS the shape (bulge over the endpoints = frown ∩ over a cap opening).
    const { glyphs, scale } = pathTextLayout(path.p0, path.control, path.p2, charWidths, spacingPx)
    placements = glyphs.map((g) => ({ cx: g.x, cy: g.y, angle: g.angle }))
    orderedChars = chars
    effFontSize = fSize * scale
  } else {
    // DEGREES model (unchanged): curveAmount > 0 is 'curve-up' = a FROWN ∩ (matches the Curve slider);
    // < 0 is 'curve-down' = a smile ∪, which reverses glyph order. Magnitude = subtended degrees.
    const isDown = !(curveAmount > 0)
    orderedChars = isDown ? [...chars].reverse() : chars
    const orderedWidths = isDown ? [...charWidths].reverse() : charWidths
    // SHARED arc geometry (curveGeometry.ts) — the cut engine uses the same function, so preview and print
    // can't diverge. Returns the radius + each glyph's center angle for the requested degrees.
    const { radius, angles } = curveArcGeometry(orderedWidths, spacingPx, curveAmount)
    const dy = isDown ? radius : -radius
    // world of (0,dy) after rotate(a): (−dy·sin a, dy·cos a) — glyph center; rotation is the same angle.
    placements = angles.map((a) => ({ cx: -dy * Math.sin(a), cy: dy * Math.cos(a), angle: a }))
    effFontSize = fSize
  }

  const renderFont = `${cItalic ? 'italic' : 'normal'} ${cBold ? 'bold' : 'normal'} ${effFontSize}px ${cFont}`

  // Bbox the glyph-center points so the canvas fits ANY placement — a shallow cap, a full circle, or a
  // drawn path.
  let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity
  placements.forEach(({ cx, cy }) => {
    if (cx < cMinX) cMinX = cx; if (cx > cMaxX) cMaxX = cx
    if (cy < cMinY) cMinY = cy; if (cy > cMaxY) cMaxY = cy
  })
  if (!placements.length) { cMinX = cMinY = cMaxX = cMaxY = 0 }
  const margin = effFontSize * 1.15 // glyph extent (asc/desc) + a little breathing room
  const W0 = Math.min(4000, Math.max(1, Math.ceil((cMaxX - cMinX) + margin * 2)))
  const H0 = Math.min(4000, Math.max(1, Math.ceil((cMaxY - cMinY) + margin * 2)))
  const originX = margin - cMinX
  const originY = margin - cMinY

  const off = makeCanvas(W0, H0)
  const ctx = off.getContext('2d')!
  ctx.font = renderFont
  ctx.fillStyle = cFill
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  orderedChars.forEach((ch, idx) => {
    const pl = placements[idx]
    if (!pl) return
    ctx.save()
    ctx.translate(originX + pl.cx, originY + pl.cy)
    ctx.rotate(pl.angle)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })

  // Crop to actual inked pixels
  const W = off.width, H = off.height
  const pixels = ctx.getImageData(0, 0, W, H).data
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (pixels[(y * W + x) * 4 + 3] > 10) {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
    }
  }
  const pad = Math.ceil(effFontSize * 0.3)
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad)
  const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY)

  const crop = makeCanvas(cw, ch)
  const cropCtx = crop.getContext('2d')!
  cropCtx.drawImage(off, minX, minY, cw, ch, 0, 0, cw, ch)
  return { dataUrl: crop.toDataURL('image/png'), width: crop.width, height: crop.height }
}
