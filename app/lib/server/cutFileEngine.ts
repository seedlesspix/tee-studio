// Cut-file engine (Node runtime only). Turns one placed text object into an
// Illustrator-clean, physically-sized SVG of OUTLINED glyph paths — the shape a Roland
// (via Illustrator) can cut directly. Coordinates are baked absolute in a 300-units/in
// space; no <text>, no stroke, no transform. Vertical leading is a faithful cap-centered
// approximation (exact Fabric leading is a Stage-2 registration refinement).
import * as opentype from 'opentype.js'
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
}
export type CutSvgOptions = { dpi?: number; decimalPlaces?: number; layerName?: string }

type Cmd = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

// Apply a 2x3 affine [a,b,c,d,e,f] to path commands (control points included).
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
  // flipY:false — glyph getPath() coords are already in our y-down space; don't re-flip.
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

export function buildTextCutSvg(
  font: opentype.Font, place: TextPlacement,
  canvasBox: CanvasBox, phys: PhysBox, opts: CutSvgOptions = {},
): string {
  const dpi = opts.dpi ?? 300, dp = opts.decimalPlaces ?? 2

  // canvas-px -> SVG user units (dpi units per inch), per-axis for POSITION; glyph SHAPE
  // uses one uniform factor (opentype fontSize is scalar). Equal when template DPI is
  // isotropic (enforced at template setup).
  const uX = (phys.width_in * dpi) / canvasBox.width
  const uY = (phys.height_in * dpi) / canvasBox.height
  const uPerPx = uY
  const viewW = Math.round(phys.width_in * dpi)
  const viewH = Math.round(phys.height_in * dpi)

  const fontSizeU = place.fontSizePx * place.scaleY * uPerPx
  const scale = fontSizeU / font.unitsPerEm
  const spaceU = (place.charSpacing / 1000) * fontSizeU
  const os2 = (font.tables as unknown as { os2?: { sCapHeight?: number } }).os2
  const capU = ((os2 && os2.sCapHeight) ? os2.sCapHeight : 0.7 * font.unitsPerEm) * scale

  // object center in units (origin = print-box top-left)
  const cxU = (place.left - canvasBox.left) * uX
  const cyU = (place.top - canvasBox.top) * uY

  const lines = place.text.split('\n')
  // Fabric 7.3.1 intrinsic block height (× scaleY): 1 line = fontSize*1.13; n lines =
  // fontSize*1.13*(1+(n-1)*1.16). Centered on cy (originY=center).
  const blockH = place.fontSizePx * 1.13 * (1 + (lines.length - 1) * 1.16) * place.scaleY * uPerPx
  const slotU = place.fontSizePx * 1.13 * place.scaleY * uPerPx        // one line's slot
  const advU = place.fontSizePx * 1.13 * 1.16 * place.scaleY * uPerPx  // line-to-line advance
  const blockTop = cyU - blockH / 2

  // pass 1: per-line advance widths (kerning + charSpacing) -> block width for align
  const measured = lines.map(line => {
    const gs = font.stringToGlyphs(line); let w = 0
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
    // baseline: cap band centered in this line's slot (faithful for all-caps)
    const baseY = blockTop + li * advU + (slotU + capU) / 2
    for (let i = 0; i < gs.length; i++) {
      if (i > 0) penX += font.getKerningValue(gs[i - 1], gs[i]) * scale
      let cmds = (gs[i].getPath(penX, baseY, fontSizeU).commands as unknown) as Cmd[]
      if (place.angle) cmds = transformCmds(cmds, rotateAbout(place.angle, cxU, cyU))
      const d = cmdsToD(cmds, dp)
      if (d) parts.push(d)
      penX += (gs[i].advanceWidth ?? 0) * scale + spaceU
    }
  })

  const idSafe = (opts.layerName ?? place.fill).replace(/[^A-Za-z0-9]+/g, '_').replace(/^(\d)/, '_$1')
  const name = opts.layerName ?? place.fill
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${phys.width_in}in" height="${phys.height_in}in" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
  <defs><clipPath id="printBox" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="${viewW}" height="${viewH}"/></clipPath></defs>
  <g id="${idSafe}" data-name="${esc(name)}" clip-path="url(#printBox)">
    <path fill="${place.fill}" fill-rule="nonzero" d="${parts.join(' ')}"/>
  </g>
</svg>`
}
