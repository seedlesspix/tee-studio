// Phase 2 (cut model): place a raster's SEPARATED cut geometry into the print area's physical space.
// separateRasterForCut traces in the image's own clamped-pixel space (viewBox = its px); this maps each
// layer (contour + per-vinyl-color) to the SAME 300-DPI physical space + position as the vector cuts, using
// the raster object's Fabric placement — the identical transform chain the clipart engine uses (center
// origin → scale/rotate/translate → print-box origin → 300 DPI), plus flipX/flipY. So a mixed order's
// vinyl outlines and contour land exactly where the art sits, cuttable at true size.
import svgpath from 'svgpath'
import type { CanvasBox } from './cutFileGeometry'
import type { PhysBox } from './cutFileEngine'
import type { NamedCutLayer } from './cutBoolean'
import type { SeparateResult } from './rasterSeparate'

type Placement = {
  left: number; top: number; scaleX: number; scaleY: number
  angle: number; width: number; height: number; flipX: boolean; flipY: boolean
}

const vbOf = (svg: string) => { const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/); return m ? { w: +m[1], h: +m[2] } : null }
const pathsOf = (svg: string) => [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map(m => m[1])

// Traced-px (image-clamped space) → physical 300-DPI, placed where the raster sits. Mirrors clipartCutEngine:
// image px → center origin → object scale/rotate/translate (canvas px) → print-box origin → physical units.
function toPhysical(d: string, vbW: number, vbH: number, p: Placement, box: CanvasBox, phys: PhysBox, dpi = 300, dp = 2): string {
  const uX = (phys.width_in * dpi) / box.width, uY = (phys.height_in * dpi) / box.height
  const sImgX = (p.width / vbW) * (p.flipX ? -1 : 1)   // traced px → image px, with horizontal flip
  const sImgY = (p.height / vbH) * (p.flipY ? -1 : 1)
  return svgpath(d)
    .scale(sImgX, sImgY)
    .translate(-p.width / 2 * (p.flipX ? -1 : 1), -p.height / 2 * (p.flipY ? -1 : 1)) // center origin (flip-aware)
    .scale(p.scaleX, p.scaleY)
    .rotate(p.angle)
    .translate(p.left, p.top)
    .translate(-box.left, -box.top)
    .scale(uX, uY)
    .abs().round(dp).toString()
}

// Neutral fill so the transfer contour reads DISTINCT from a black vinyl layer in Illustrator.
const CONTOUR_FILL = '#808080'

// Build the named cut layers (Contour + one per vinyl color) for one raster, in physical space.
// idx > 0 suffixes the names ("Contour 2") when a side carries more than one raster.
export function placeRasterCutLayers(sep: SeparateResult, obj: Record<string, unknown>, box: CanvasBox, phys: PhysBox, idx = 0): NamedCutLayer[] {
  const p: Placement = {
    left: Number(obj.left) || 0, top: Number(obj.top) || 0,
    scaleX: Number(obj.scaleX ?? 1), scaleY: Number(obj.scaleY ?? 1),
    angle: Number(obj.angle ?? 0),
    width: Number(obj.width) || 0, height: Number(obj.height) || 0,
    flipX: obj.flipX === true, flipY: obj.flipY === true,
  }
  if (!p.width || !p.height) return []
  const suffix = idx > 0 ? ` ${idx + 1}` : ''
  const layers: NamedCutLayer[] = []
  if (sep.contour) {
    const vb = vbOf(sep.contour)
    if (vb) layers.push({ name: `Contour${suffix}`, fill: CONTOUR_FILL, d: pathsOf(sep.contour).map(d => toPhysical(d, vb.w, vb.h, p, box, phys)).join(' ') })
  }
  for (const s of sep.solids) {
    const vb = vbOf(s.svg)
    if (vb) layers.push({ name: `Vinyl ${s.color}${suffix}`, fill: s.color, d: pathsOf(s.svg).map(d => toPhysical(d, vb.w, vb.h, p, box, phys)).join(' ') })
  }
  return layers
}
