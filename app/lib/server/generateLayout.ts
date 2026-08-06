// Placement/layout sheet per side (Phase 5, Stage 3). NOT a cut file — it's the assembly map
// for the bench: the print-area artboard at TRUE inches with EVERY element (cuttable AND
// raster) at its placed size/position, so the shop knows where each piece goes at real scale
// (and can pull a placed-size print from it). Vector objects reuse the proven cut-file
// outlining; raster images are embedded as <image> via the same canvas->inch transform (minus
// the SVG-viewBox step the clipart path used). Draw order (z-order) is preserved.
import * as opentype from 'opentype.js'
import type { CanvasBox } from './cutFileGeometry'
import type { PhysBox } from './cutFileEngine'
import { prepareSide, isRasterObj, isTextObj, isCurvedObj, isClipartObj, outlineVectorObject } from './generateCutFile'
import { placedInches, lowResTier, effectiveDpi } from '../lowRes'

export type LayoutResult =
  | { ok: true; svg: string; failures: string[] }
  | { ok: false; reason: 'no-design' | 'no-print-area' | 'bad-json' | 'empty'; message: string }

// --- 2x3 affine helpers (SVG matrix(a b c d e f): (x,y) -> (a*x+c*y+e, b*x+d*y+f)) ---
type Mat = [number, number, number, number, number, number]
const translateM = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
const scaleM = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0]
const rotateM = (deg: number): Mat => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0] }
function mul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ]
}
const composeMatrix = (mats: Mat[]): Mat => mats.reduce((acc, m) => mul(acc, m))
const round = (n: number, dp = 4) => { const f = 10 ** dp; return Math.round(n * f) / f }

function guessMime(src: string): string {
  const s = src.toLowerCase()
  if (s.includes('.jpg') || s.includes('.jpeg')) return 'image/jpeg'
  if (s.includes('.webp')) return 'image/webp'
  if (s.includes('.gif')) return 'image/gif'
  return 'image/png'
}

async function toDataUri(src: string): Promise<string | null> {
  if (src.startsWith('data:')) return src
  try {
    const res = await fetch(src)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const ct = res.headers.get('content-type') || guessMime(src)
    return `data:${ct};base64,${buf.toString('base64')}`
  } catch { return null }
}

// Embed one raster image at its true placed size/position as an <image>. Prefer the uploaded
// source (_uploadSrc, higher-res) over the canvas display rendition so the layout can double
// as a placed-size print.
async function rasterFragment(t: Record<string, unknown>, canvasBox: CanvasBox, phys: PhysBox, dpi = 300): Promise<string | null> {
  const src = String(t._uploadSrc || t.src || '')
  const natW = Number(t.width ?? 0), natH = Number(t.height ?? 0)
  if (!src || !natW || !natH) return null
  const href = await toDataUri(src)
  if (!href) return null
  const uX = (phys.width_in * dpi) / canvasBox.width
  const uY = (phys.height_in * dpi) / canvasBox.height
  // natural-px space -> center origin -> object scale/rotate/translate (canvas px) ->
  // print-box origin -> physical 300-DPI units. Same chain the clipart engine proved true.
  const M = composeMatrix([
    scaleM(uX, uY),
    translateM(-canvasBox.left, -canvasBox.top),
    translateM(Number(t.left), Number(t.top)),
    rotateM(Number(t.angle ?? 0)),
    scaleM(Number(t.scaleX ?? 1), Number(t.scaleY ?? 1)),
    translateM(-natW / 2, -natH / 2),
  ])
  const mm = M.map(n => round(n)).join(' ')
  // xlink:href for maximum Illustrator compatibility with embedded rasters.
  return `  <image x="0" y="0" width="${natW}" height="${natH}" transform="matrix(${mm})" preserveAspectRatio="none" xlink:href="${href}"/>`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Readable filename for the bench note (skip data: URIs + query strings; clamp length).
function imgName(t: Record<string, unknown>): string {
  const src = String(t._uploadSrc || t.src || '')
  if (!src || src.startsWith('data:')) return 'image'
  const base = src.split('/').pop()?.split('?')[0] || 'image'
  return base.length > 40 ? base.slice(0, 37) + '…' : base
}

// Bench resolution flag for one raster: tiny source, or low effective DPI at the PLACED size. Uses the
// SAME shared lowRes core (placedInches/lowResTier/effectiveDpi) as the designer's live customer warning,
// so the two can't disagree on what's at-risk. Returns a note for OrderInfo.txt (with the DPI number for
// the bench), or null if fine.
function rasterDpiNote(t: Record<string, unknown>, canvasBox: CanvasBox, phys: PhysBox): string | null {
  if (t._isVectorUpload) return null // uploaded SVG = vector, prints crisp at any size (matches the client)
  const natW = Number(t.width ?? 0), natH = Number(t.height ?? 0)
  if (!natW || !natH) return null
  const name = imgName(t)
  const sx = Number(t.scaleX ?? 1) || 1, sy = Number(t.scaleY ?? 1) || 1
  const placedInW = placedInches(natW * sx, canvasBox.width, phys.width_in)
  const placedInH = placedInches(natH * sy, canvasBox.height, phys.height_in)
  const tier = lowResTier(natW, natH, placedInW, placedInH)
  if (tier === 'small') return `image ${name} is low-resolution (${natW}×${natH}px) — may print blurry`
  if (tier === 'placed') return `image ${name} ~${Math.round(effectiveDpi(natW, natH, placedInW, placedInH))} DPI at placed size — LOW (may print blurry; 300+ ideal)`
  return null
}

function assembleLayoutSvg(fragments: string[], phys: PhysBox, dpi = 300): string {
  const viewW = Math.round(phys.width_in * dpi), viewH = Math.round(phys.height_in * dpi)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${phys.width_in}in" height="${phys.height_in}in" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
  <!-- PLACEMENT/LAYOUT REFERENCE — every element at true placed size + position. NOT a cut file. -->
  <rect x="0" y="0" width="${viewW}" height="${viewH}" fill="none" stroke="#cccccc" stroke-width="2" stroke-dasharray="12 8"/>
${fragments.join('\n')}
</svg>`
}

export async function generateLayoutSvgForSide(
  canvasJson: string | null | undefined, snap: unknown, opts: { fontOverride?: string | null } = {},
): Promise<LayoutResult> {
  const prep = prepareSide(canvasJson, snap)
  if (!prep.ok) return prep
  const { objects, canvasBox, phys } = prep

  const fontCache = new Map<string, opentype.Font>()
  const failures: string[] = []
  const fragments: string[] = []
  // Iterate in draw order so a photo behind text stacks correctly on the sheet.
  for (const t of objects) {
    if (isRasterObj(t)) {
      // Bench resolution flag (independent of embed success) so at-risk art is visible before printing.
      const dpiNote = rasterDpiNote(t, canvasBox, phys)
      if (dpiNote) failures.push(dpiNote)
      try {
        const frag = await rasterFragment(t, canvasBox, phys)
        if (frag) fragments.push(frag)
        else failures.push('image — could not embed (missing src or size)')
      } catch (e) { failures.push(`image — ${(e as Error).message}`) }
    } else if (isTextObj(t) || isCurvedObj(t) || isClipartObj(t)) {
      const r = await outlineVectorObject(t, canvasBox, phys, fontCache, opts)
      if ('failure' in r) failures.push(r.failure)
      else for (const p of r.paths) if (p.d) fragments.push(`  <path fill="${esc(p.fill)}" fill-rule="nonzero" d="${p.d}"/>`)
    }
  }

  if (fragments.length === 0) {
    return { ok: false, reason: 'empty', message: failures.length ? `no placeable elements (${failures.join('; ')})` : 'no placeable elements on this side' }
  }
  return { ok: true, svg: assembleLayoutSvg(fragments, phys), failures }
}
