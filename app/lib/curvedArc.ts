// Pure curved-text arc rasterizer — the render half of a "curved text" bake, lifted VERBATIM from the
// designer's curve useEffect so the browser path is byte-for-byte unchanged, but headless-callable
// (no React state, no active object) so D2 Design Portability can re-curve a design on the way onto a
// new garment. Given a string + bake params, it lays each character along an arc, crops to the inked
// pixels, and returns a PNG data URL + its cropped dimensions. Everything Fabric-/DOM-position-related
// (the FabricImage wrapper + print-area constrain) stays in the designer's bakeCurvedArc wrapper.
//
// Canvas comes from a factory so the SAME code runs against the browser DOM canvas in production AND
// node-canvas in tests (the parity guard) — no other behavioral difference.

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
  const { curveAmount, fontSize: fSize, fontFamily: cFont, fill: cFill, bold: cBold, italic: cItalic, charSpacing = 0 } = p
  const direction = curveAmount > 0 ? 'curve-up' : 'curve-down'
  const isDown = direction === 'curve-down'
  const fontStr = `${cItalic ? 'italic' : 'normal'} ${cBold ? 'bold' : 'normal'} ${fSize}px ${cFont}`
  // Per-glyph gap in px, matching Fabric's charSpacing (1/1000 em) so curved + straight spacing agree.
  const spacingPx = (charSpacing / 1000) * fSize

  const tmp = makeCanvas(1, 1)
  const tmpCtx = tmp.getContext('2d')!
  tmpCtx.font = fontStr
  const chars = rawText.split('')
  const charWidths = chars.map((ch) => tmpCtx.measureText(ch).width)
  const totalWidth = charWidths.reduce((a, b) => a + b, 0)
  // Arc length the glyphs (+ their spacing) occupy — sets the radius for the requested angle.
  const totalEff = totalWidth + spacingPx * chars.length

  // curveAmount IS the subtended angle in degrees now. Clamp to a full circle; guard a tiny floor so a
  // near-zero value renders nearly straight instead of dividing by zero. radius follows from arc length
  // ÷ angle, so the text ALWAYS spans exactly `curveAmount` degrees (was: radius chosen, angle emergent).
  const totalAngle = Math.max((Math.min(360, Math.abs(curveAmount)) * Math.PI) / 180, 1e-3)
  const radius = totalEff / totalAngle
  const dy = direction === 'curve-up' ? -radius : radius

  const orderedChars = isDown ? [...chars].reverse() : chars
  const orderedWidths = isDown ? [...charWidths].reverse() : charWidths

  // First pass: each glyph's arc angle (centered on the glyph; advance includes its spacing) and its
  // center point relative to the circle centre. We bbox those points so the canvas fits ANY angle —
  // a shallow cap OR a full circle — instead of the old fixed 1200 box + partial-arc assumption.
  const angles: number[] = []
  let cur = -totalAngle / 2
  let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity
  orderedChars.forEach((_ch, idx) => {
    const a = cur + (orderedWidths[idx] / radius) / 2
    angles.push(a)
    const px = -dy * Math.sin(a) // world of (0,dy) after rotate(a): (−dy·sin a, dy·cos a)
    const py = dy * Math.cos(a)
    if (px < cMinX) cMinX = px; if (px > cMaxX) cMaxX = px
    if (py < cMinY) cMinY = py; if (py > cMaxY) cMaxY = py
    cur += (orderedWidths[idx] + spacingPx) / radius
  })
  const margin = fSize * 1.15 // glyph extent (asc/desc) + a little breathing room
  const W0 = Math.min(4000, Math.max(1, Math.ceil((cMaxX - cMinX) + margin * 2)))
  const H0 = Math.min(4000, Math.max(1, Math.ceil((cMaxY - cMinY) + margin * 2)))
  const originX = margin - cMinX
  const originY = margin - cMinY

  const off = makeCanvas(W0, H0)
  const ctx = off.getContext('2d')!
  ctx.font = fontStr
  ctx.fillStyle = cFill
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  orderedChars.forEach((ch, idx) => {
    ctx.save()
    ctx.translate(originX, originY)
    ctx.rotate(angles[idx])
    ctx.translate(0, dy)
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
  const pad = Math.ceil(fSize * 0.3)
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad)
  const cw = Math.max(1, maxX - minX), ch = Math.max(1, maxY - minY)

  const crop = makeCanvas(cw, ch)
  const cropCtx = crop.getContext('2d')!
  cropCtx.drawImage(off, minX, minY, cw, ch, 0, 0, cw, ch)
  return { dataUrl: crop.toDataURL('image/png'), width: crop.width, height: crop.height }
}
