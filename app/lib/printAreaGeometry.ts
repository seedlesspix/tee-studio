// Print-area containment geometry — the objectFit:contain transform that maps
// an admin-captured print area (in the mockup's NATURAL pixels) into the
// percentage box the designer overlay renders inside the fixed 680×850 canvas.
//
// Extracted verbatim from DesignerCanvas's inline `toPct` and PINNED as a single
// source of truth, immune to silent drift during the CanvasStage extraction.
// Pure (no DOM), so it's testable in Node. Scope is square-only (KISS,
// 2026-07-30): the catalog is all 2000×2000 square (offset 0.1); non-square /
// pillarbox support was dropped as speculative and can be rebuilt if a real
// portrait-garment need appears.
//
// The mockup is drawn objectFit:contain, so it's scaled to fit the canvas and
// letterboxed (top/bottom) with an offset; the print area must be placed inside
// that *rendered* box, then expressed as a % of the container. Ignoring the
// offset stretches the box vertically and shifts it by the missing offset (the
// Phase-3 Day-3 bug).

export const CANVAS_W = 680
export const CANVAS_H = 850

export type PrintAreaPx = { x_px: number; y_px: number; width_px: number; height_px: number }
export type PrintAreaPct = { xPct: number; yPct: number; widthPct: number; heightPct: number }

export function toPctContain(
  area: PrintAreaPx,
  naturalW: number,
  naturalH: number,
  containerW: number = CANVAS_W,
  containerH: number = CANVAS_H
): PrintAreaPct {
  const containerAspect = containerW / containerH
  const imageAspect = naturalW / naturalH
  const fx = area.x_px / naturalW
  const fy = area.y_px / naturalH
  const fw = area.width_px / naturalW
  const fh = area.height_px / naturalH
  // Square-only scope (KISS, 2026-07-30): every garment mockup is square (or
  // landscape), so the image fills the container WIDTH and is letterboxed
  // top/bottom — one path, no pillarbox branch. The former portrait/pillarbox
  // branch was dropped as speculative; rebuild it if a portrait garment mockup
  // is ever added. The Math.min clamp degrades a stray portrait mockup to
  // "fills height" (offset 0) rather than emitting negative offsets.
  const rhFrac = Math.min(1, containerAspect / imageAspect) // rendered height / container height
  const offY = (1 - rhFrac) / 2
  const xFrac = fx
  const wFrac = fw
  const yFrac = offY + fy * rhFrac
  const hFrac = fh * rhFrac
  return { xPct: xFrac * 100, yPct: yFrac * 100, widthPct: wFrac * 100, heightPct: hFrac * 100 }
}

// Map ONE point in the mockup's NATURAL pixels into the 680×850 canvas using the SAME objectFit:contain
// transform as toPctContain — so a drawn arc (Z-hp curve_path) lands exactly where the print box does.
// Returns canvas pixels. (Same square-only letterbox-top/bottom scope as toPctContain.)
export function mockupPxToCanvas(
  pt: { x: number; y: number },
  naturalW: number,
  naturalH: number,
  containerW: number = CANVAS_W,
  containerH: number = CANVAS_H,
): { x: number; y: number } {
  const containerAspect = containerW / containerH
  const imageAspect = naturalW / naturalH
  const rhFrac = Math.min(1, containerAspect / imageAspect)
  const offY = (1 - rhFrac) / 2
  return {
    x: (pt.x / naturalW) * containerW,
    y: (offY + (pt.y / naturalH) * rhFrac) * containerH,
  }
}

// The letterbox offset for a given mockup — how far this mockup's aspect is from
// the container's (0 = same ratio, no boxing). Square-only scope (KISS,
// 2026-07-30): letterbox top/bottom always; the pillarbox case was dropped.
export function letterboxInfo(
  naturalW: number,
  naturalH: number,
  containerW: number = CANVAS_W,
  containerH: number = CANVAS_H
) {
  const containerAspect = containerW / containerH
  const imageAspect = naturalW / naturalH
  const rhFrac = Math.min(1, containerAspect / imageAspect)
  return { imageAspect, containerAspect, mode: 'letterbox-top/bottom' as const, renderFrac: rhFrac, offset: (1 - rhFrac) / 2 }
}
