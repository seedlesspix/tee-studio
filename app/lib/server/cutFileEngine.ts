// Cut-file engine (Node runtime only). Outlines each vector object to true glyph/shape
// paths and assembles a color-LAYERED, physically-sized, Illustrator-clean SVG — one
// named layer per print color (Denise's "one file per side, colors as layers"). No
// <text>, no stroke, no transform; coordinates baked absolute in a 300-units/in space.
import * as opentype from 'opentype.js'
import { curveArcGeometry } from '../curveGeometry'
import type { CanvasBox } from './cutFileGeometry'

export type PhysBox = { width_in: number; height_in: number }
export type TextPlacement = {
  text: string            // obj.text — final casing + wrap \n ALREADY baked in (verbatim)
  fontSizePx: number      // fabric fontSize (canvas-px em)
  scaleX: number; scaleY: number
  left: number; top: number  // object CENTER in 680×850 px (originX/originY = center)
  angle: number           // degrees, clockwise
  fill: string            // "#RRGGBB"
  textAlign: 'left' | 'center' | 'right'
  charSpacing: number     // 1/1000 em
  italic: boolean         // faux-italic (skew) — fonts are single-weight/upright files
}
export type CutSvgOptions = { dpi?: number; decimalPlaces?: number }

// Faux-italic shear (~12°): the designer applies italic as browser faux-styling on an
// upright font file, so opentype outlines it upright — we slant it to match. Bold has no
// clean faux (path-union is heavy); multi-weight Google fonts get real bold via the weight
// param instead, and single-weight files stay their native weight.
const ITALIC_SHEAR = 0.21
// x' = x - k*(y - baseY): slants everything above the baseline to the right.
const shearItalic = (baseY: number): number[] => [1, 0, -ITALIC_SHEAR, 1, ITALIC_SHEAR * baseY, 0]
// One outlined object: its merged path data + the print color it cuts in.
export type CutPath = { d: string; fill: string }

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

// Map a line to its glyphs, GSUB-safe. opentype.js applies GSUB during stringToGlyphs and THROWS on
// lookups it hasn't implemented (e.g. Roboto: lookupType 6 substFormat 2; Calistoga: substFormat 2),
// which would fail the whole cut file. A cut file wants each character's BASE glyph anyway (no
// contextual/ligature substitution), so on a throw we fall back to per-character charToGlyph — which
// never applies GSUB. Fonts whose stringToGlyphs succeeds are unchanged (kerning/behavior identical).
function glyphsForLine(font: opentype.Font, line: string): opentype.Glyph[] {
  try {
    return font.stringToGlyphs(line)
  } catch {
    return Array.from(line).map(ch => font.charToGlyph(ch))
  }
}

function transformCmds(cmds: Cmd[], [a, b, c, d, e, f]: number[]): Cmd[] {
  const X = (x: number, y: number) => a * x + c * y + e
  const Y = (x: number, y: number) => b * x + d * y + f
  return cmds.map(cmd => {
    const o: Cmd = { type: cmd.type }
    if (cmd.type === 'Z') return o
    if (cmd.type === 'C') { o.x1 = X(cmd.x1!, cmd.y1!); o.y1 = Y(cmd.x1!, cmd.y1!); o.x2 = X(cmd.x2!, cmd.y2!); o.y2 = Y(cmd.x2!, cmd.y2!) }
    if (cmd.type === 'Q') { o.x1 = X(cmd.x1!, cmd.y1!); o.y1 = Y(cmd.x1!, cmd.y1!) }
    o.x = X(cmd.x!, cmd.y!); o.y = Y(cmd.x!, cmd.y!)
    return o
  })
}
function cmdsToD(cmds: Cmd[], dp: number): string {
  const p = new opentype.Path()
  ;(p as unknown as { commands: Cmd[] }).commands = cmds
  return (p as unknown as { toPathData: (o: unknown) => string })
    .toPathData({ decimalPlaces: dp, flipY: false })
}
// θ° clockwise about (cx,cy) in y-DOWN space -> 2x3 affine
function rotateAbout(deg: number, cx: number, cy: number): number[] {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}
function esc(s: string): string {
  return s.replace(/[<>&"]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[m]!))
}

// Outline ONE text object -> merged path 'd' (all its glyphs) + its fill. Coordinates
// are absolute in the 300-DPI print-area space (dpi units per inch). Vertical leading is
// a faithful cap-centered approximation (exact Fabric leading is a later refinement).
export function outlineText(
  font: opentype.Font, place: TextPlacement, canvasBox: CanvasBox, phys: PhysBox, opts: CutSvgOptions = {},
): CutPath {
  const dpi = opts.dpi ?? 300, dp = opts.decimalPlaces ?? 2

  const uX = (phys.width_in * dpi) / canvasBox.width
  const uY = (phys.height_in * dpi) / canvasBox.height
  const uPerPx = uY

  const fontSizeU = place.fontSizePx * place.scaleY * uPerPx
  const scale = fontSizeU / font.unitsPerEm
  const spaceU = (place.charSpacing / 1000) * fontSizeU
  const os2 = (font.tables as unknown as { os2?: { sCapHeight?: number } }).os2
  const capU = ((os2 && os2.sCapHeight) ? os2.sCapHeight : 0.7 * font.unitsPerEm) * scale

  const cxU = (place.left - canvasBox.left) * uX
  const cyU = (place.top - canvasBox.top) * uY

  const lines = place.text.split('\n')
  const blockH = place.fontSizePx * 1.13 * (1 + (lines.length - 1) * 1.16) * place.scaleY * uPerPx
  const slotU = place.fontSizePx * 1.13 * place.scaleY * uPerPx
  const advU = place.fontSizePx * 1.13 * 1.16 * place.scaleY * uPerPx
  const blockTop = cyU - blockH / 2

  const measured = lines.map(line => {
    const gs = glyphsForLine(font, line); let w = 0
    for (let i = 0; i < gs.length; i++) {
      if (i > 0) w += font.getKerningValue(gs[i - 1], gs[i]) * scale
      w += (gs[i].advanceWidth ?? 0) * scale
      if (i < gs.length - 1) w += spaceU
    }
    return { gs, w }
  })
  const blockW = Math.max(...measured.map(m => m.w))

  const parts: string[] = []
  measured.forEach(({ gs, w }, li) => {
    const leftEdge = cxU - blockW / 2
    let penX = place.textAlign === 'left' ? leftEdge
      : place.textAlign === 'right' ? leftEdge + (blockW - w)
      : cxU - w / 2
    const baseY = blockTop + li * advU + (slotU + capU) / 2
    for (let i = 0; i < gs.length; i++) {
      if (i > 0) penX += font.getKerningValue(gs[i - 1], gs[i]) * scale
      let cmds = (gs[i].getPath(penX, baseY, fontSizeU).commands as unknown) as Cmd[]
      if (place.italic) cmds = transformCmds(cmds, shearItalic(baseY))
      if (place.angle) cmds = transformCmds(cmds, rotateAbout(place.angle, cxU, cyU))
      const d = cmdsToD(cmds, dp)
      if (d) parts.push(d)
      penX += (gs[i].advanceWidth ?? 0) * scale + spaceU
    }
  })

  return { d: parts.join(' '), fill: place.fill }
}

export type CurveParams = {
  curveAmount: number   // _curveAmount (signed; sign = up/down; magnitude = subtended degrees)
  fontSizePx: number    // _curveFontSize (canvas-px em)
  bold: boolean
  italic: boolean
  charSpacing?: number  // _curveCharSpacing (Fabric 1/1000 em; letter spacing) — default 0
}
export type ImagePlacement = {
  left: number; top: number      // baked-image CENTER in 680×850 (originX/originY=center)
  scaleX: number; scaleY: number // stored fit scale
  angle: number                  // degrees clockwise
}

// bbox anchor + control points of a command
function cmdPts(c: Cmd): Array<[number, number]> {
  const p: Array<[number, number]> = []
  if (c.x1 != null && c.y1 != null) p.push([c.x1, c.y1])
  if (c.x2 != null && c.y2 != null) p.push([c.x2, c.y2])
  if (c.x != null && c.y != null) p.push([c.x, c.y])
  return p
}
// Recenter a glyph (getPath'd at 0,0) on its advance/em-middle pivot, rotate by charAngle
// (clockwise y-down), drop it at arc point P. -> 2x3 affine (transformCmds convention).
function glyphArcAffine(charAngle: number, advPx: number, midPx: number, Px: number, Py: number): number[] {
  const co = Math.cos(charAngle), si = Math.sin(charAngle)
  const tx = -advPx / 2, ty = midPx
  return [co, si, -si, co, co * tx - si * ty + Px, si * tx + co * ty + Py]
}

// Curved text -> TRUE vector glyph paths from the stored bake params (_curve*), using the SHARED
// arc geometry (curveGeometry.ts) so the cut matches the on-screen preview EXACTLY — degrees model
// (curveAmount = subtended degrees) + letter spacing; curve-down reverses order. Places the
// content-bbox center at the baked image's
// left/top, applies its scaleX/scaleY + angle, then the same canvas->physical transform
// as outlineText. Single-line only (curved text is). Returns merged path 'd'; caller
// supplies fill = _curveFill.
export function curvedTextToCutPath(
  font: opentype.Font,
  originalText: string,
  curve: CurveParams,
  place: ImagePlacement,
  canvasBox: CanvasBox,
  phys: PhysBox,
  opts: CutSvgOptions = {},
): string {
  const dpi = opts.dpi ?? 300, dp = opts.decimalPlaces ?? 2
  const line = originalText.replace(/\n/g, ' ')
  const S = curve.fontSizePx
  const scale = S / font.unitsPerEm

  const A = curve.curveAmount, up = A > 0
  const spacingPx = ((curve.charSpacing ?? 0) / 1000) * S   // Fabric 1/1000 em → px (matches the preview)
  const glyphs = glyphsForLine(font, line)
  const widths = glyphs.map(g => (g.advanceWidth ?? 0) * scale)
  const seq = glyphs.map((g, i) => ({ g, w: widths[i] }))
  const ordered = up ? seq : [...seq].reverse()
  const orderedWidths = ordered.map(s => s.w)
  // SHARED degrees-model geometry (curveGeometry.ts) — identical to the on-screen preview, incl. spacing.
  const { radius, angles } = curveArcGeometry(orderedWidths, spacingPx, A)
  const midPx = ((font.ascender + font.descender) / 2) * scale

  const arcCmds: Cmd[][] = []
  ordered.forEach(({ g, w }, i) => {
    const ca = angles[i]
    const Px = up ? radius * Math.sin(ca) : -radius * Math.sin(ca)
    const Py = up ? -radius * Math.cos(ca) : radius * Math.cos(ca)
    let cmds = (g.getPath(0, 0, S).commands as unknown) as Cmd[]
    if (curve.italic) cmds = transformCmds(cmds, shearItalic(0))
    arcCmds.push(transformCmds(cmds, glyphArcAffine(ca, w, midPx, Px, Py)))
  })

  // content-bbox center in arc-space (matches the raster's tight centered crop)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const cs of arcCmds) for (const c of cs) for (const [x, y] of cmdPts(c)) {
    if (x < minX) minX = x; if (y < minY) minY = y
    if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  const Cx = (minX + maxX) / 2, Cy = (minY + maxY) / 2

  // arc-space -> canvas 680×850: C at (left,top), scaled by scaleX/scaleY, rotated by angle
  const ar = (place.angle * Math.PI) / 180, co = Math.cos(ar), si = Math.sin(ar)
  const a = place.scaleX * co, b = place.scaleX * si, c = -place.scaleY * si, dd = place.scaleY * co
  const M = [a, b, c, dd, place.left - (a * Cx + c * Cy), place.top - (b * Cx + dd * Cy)]

  // canvas -> physical print units (identical to outlineText)
  const uX = (phys.width_in * dpi) / canvasBox.width
  const uY = (phys.height_in * dpi) / canvasBox.height
  const U = [uX, 0, 0, uY, -canvasBox.left * uX, -canvasBox.top * uY]

  const parts: string[] = []
  for (const cs of arcCmds) {
    const dstr = cmdsToD(transformCmds(transformCmds(cs, M), U), dp)
    if (dstr) parts.push(dstr)
  }
  return parts.join(' ')
}

// Assemble a color-LAYERED, physically-sized, Illustrator-clean SVG. One named <g> layer
// per unique fill color, each a single compound path (nonzero winding). Empty paths drop.
export function assembleCutSvg(paths: CutPath[], phys: PhysBox, opts: CutSvgOptions = {}): string {
  const dpi = opts.dpi ?? 300
  const viewW = Math.round(phys.width_in * dpi)
  const viewH = Math.round(phys.height_in * dpi)

  const byColor = new Map<string, string[]>()
  for (const p of paths) {
    if (!p.d) continue
    const arr = byColor.get(p.fill) ?? []
    arr.push(p.d)
    byColor.set(p.fill, arr)
  }
  const layers = [...byColor.entries()].map(([fill, ds], i) => {
    const idSafe = fill.replace(/[^A-Za-z0-9]+/g, '_').replace(/^(\d)/, '_$1')
    return `  <g id="Layer_${i}_${idSafe}" data-name="${esc(fill)}" clip-path="url(#printBox)">\n` +
      `    <path fill="${fill}" fill-rule="nonzero" d="${ds.join(' ')}"/>\n  </g>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${phys.width_in}in" height="${phys.height_in}in" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
  <defs><clipPath id="printBox" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${viewW}" height="${viewH}"/></clipPath></defs>
${layers}
</svg>`
}
