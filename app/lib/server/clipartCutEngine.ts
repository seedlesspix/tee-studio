// Clipart -> vector cut paths. Clipart is a FabricImage pointing at a Supabase SVG (the
// vector geometry is NOT in canvas_json), so fetch + parse the source SVG, flatten its
// internal transforms, apply the object's placement (center origin, scaleX/scaleY, angle)
// mapped into the same 300-DPI print space as text, and honor the recolor tint
// (_currentColor -> one color) or the SVG's own per-path fills. Raster-PNG clipart (no
// _isSvg) has no vector data -> the caller skips it (print-and-cut only).
import { parse, type INode } from 'svgson'
import svgpath from 'svgpath'
import type { CanvasBox } from './cutFileGeometry'
import type { PhysBox, CutPath, CutSvgOptions } from './cutFileEngine'

export type ClipartPlacement = {
  src: string
  left: number; top: number      // object CENTER in 680×850 (originX/originY = center)
  scaleX: number; scaleY: number
  angle: number                  // degrees clockwise
  width: number; height: number  // Fabric image natural size (px)
  currentColor?: string          // _currentColor recolor tint (whole shape one color)
}

function readViewBox(root: INode, w: number, h: number) {
  const vb = root.attributes.viewBox?.trim().split(/[\s,]+/).map(Number)
  if (vb && vb.length === 4 && vb.every(n => Number.isFinite(n))) {
    return { vbX: vb[0], vbY: vb[1], vbW: vb[2], vbH: vb[3] }
  }
  const pw = parseFloat(root.attributes.width || '') || w || 100
  const ph = parseFloat(root.attributes.height || '') || h || 100
  return { vbX: 0, vbY: 0, vbW: pw, vbH: ph }
}

function nodeFill(node: INode): string | null {
  const a = node.attributes
  const styleFill = /(?:^|;)\s*fill\s*:\s*([^;]+)/.exec(a.style || '')?.[1]?.trim()
  if (styleFill) return styleFill === 'none' ? null : styleFill
  if (a.fill) return a.fill === 'none' ? null : a.fill
  return '#000000' // SVG default fill
}
const isNoneFill = (node: INode) =>
  node.attributes.fill === 'none' || /fill\s*:\s*none/.test(node.attributes.style || '')

// Convert the common CLOSED, fillable SVG primitives to a path 'd' so they aren't silently dropped
// from the cut — badges/borders often use <rect>/<circle>/<ellipse>/<polygon> alongside <path>, and
// dropping them produced a partial cut with no warning. Open/stroke-only shapes (<line>/<polyline>)
// aren't fillable regions, so they're not cut.
function shapeToPathD(node: INode): string | null {
  const a = node.attributes
  const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : 0 }
  switch (node.name) {
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height)
      return w > 0 && h > 0 ? `M${x},${y} H${x + w} V${y + h} H${x} Z` : null
    }
    case 'circle': {
      const cx = num(a.cx), cy = num(a.cy), r = num(a.r)
      return r > 0 ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z` : null
    }
    case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry)
      return rx > 0 && ry > 0 ? `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0 Z` : null
    }
    case 'polygon': {
      const pts = (a.points || '').trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n))
      if (pts.length < 6) return null // need at least 3 points for an area
      let d = `M${pts[0]},${pts[1]}`
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L${pts[i]},${pts[i + 1]}`
      return d + ' Z'
    }
    default:
      return null
  }
}

// Walk the tree accumulating the SVG transform string (root->leaf); collect fillable paths + shapes.
function collectPaths(node: INode, xform: string, out: { d: string; fill: string | null; xform: string }[]) {
  const t = node.attributes.transform ? `${xform} ${node.attributes.transform}`.trim() : xform
  if (!isNoneFill(node)) {
    if (node.name === 'path' && node.attributes.d) {
      out.push({ d: node.attributes.d, fill: nodeFill(node), xform: t })
    } else {
      const shaped = shapeToPathD(node)
      if (shaped) out.push({ d: shaped, fill: nodeFill(node), xform: t })
    }
  }
  for (const c of node.children || []) collectPaths(c, t, out)
}

export async function clipartToCutPaths(
  place: ClipartPlacement, canvasBox: CanvasBox, phys: PhysBox, opts: CutSvgOptions = {},
): Promise<CutPath[]> {
  const dpi = opts.dpi ?? 300, dp = opts.decimalPlaces ?? 2
  const res = await fetch(place.src)
  if (!res.ok) throw new Error(`clipart fetch ${res.status}`)
  const root = await parse(await res.text())
  const { vbX, vbY, vbW, vbH } = readViewBox(root, place.width, place.height)

  const collected: { d: string; fill: string | null; xform: string }[] = []
  collectPaths(root, '', collected)
  if (collected.length === 0) return []

  const uX = (phys.width_in * dpi) / canvasBox.width
  const uY = (phys.height_in * dpi) / canvasBox.height
  const sImgX = place.width / vbW   // SVG user -> Fabric image px
  const sImgY = place.height / vbH

  return collected.map(p => {
    let sp = svgpath(p.d)
    if (p.xform) sp = sp.transform(p.xform)            // flatten SVG-internal transforms
    // SVG user -> image px -> center origin -> object scale/rotate/translate (canvas px) ->
    // print-box origin -> physical 300-DPI units. Same coordinate target as the text engine.
    sp = sp
      .translate(-vbX, -vbY)
      .scale(sImgX, sImgY)
      .translate(-place.width / 2, -place.height / 2)
      .scale(place.scaleX, place.scaleY)
      .rotate(place.angle)
      .translate(place.left, place.top)
      .translate(-canvasBox.left, -canvasBox.top)
      .scale(uX, uY)
      .abs().round(dp)
    return { d: sp.toString(), fill: place.currentColor ?? p.fill ?? '#000000' }
  })
}
