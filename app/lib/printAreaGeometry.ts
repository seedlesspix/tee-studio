// Print-area containment geometry — the objectFit:contain transform that maps
// an admin-captured print area (in the mockup's NATURAL pixels) into the
// percentage box the designer overlay renders inside the fixed 680×850 canvas.
//
// Extracted verbatim from DesignerCanvas's inline `toPct` so it can be (a)
// unit-tested at arbitrary mockup aspect ratios — today's catalog is all
// 2000×2000 square (offset 0.1), but most future garments won't be — and (b)
// PINNED as a single source of truth, immune to silent drift during the
// CanvasStage extraction. Pure (no DOM), so it's testable in Node.
//
// The mockup is drawn objectFit:contain, so it's scaled to fit the canvas and
// letterboxed (top/bottom) or pillarboxed (left/right) with an offset; the print
// area must be placed inside that *rendered* box, then expressed as a % of the
// container. Ignoring the offset stretches the box on the boxed axis and shifts
// it by the missing offset (the Phase-3 Day-3 bug).

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
  let xFrac: number, yFrac: number, wFrac: number, hFrac: number
  if (imageAspect >= containerAspect) {
    // Fills container width; letterboxed top/bottom.
    const rhFrac = containerAspect / imageAspect // rendered height / container height
    const offY = (1 - rhFrac) / 2
    xFrac = fx; wFrac = fw
    yFrac = offY + fy * rhFrac
    hFrac = fh * rhFrac
  } else {
    // Fills container height; pillarboxed left/right.
    const rwFrac = imageAspect / containerAspect // rendered width / container width
    const offX = (1 - rwFrac) / 2
    yFrac = fy; hFrac = fh
    xFrac = offX + fx * rwFrac
    wFrac = fw * rwFrac
  }
  return { xPct: xFrac * 100, yPct: yFrac * 100, widthPct: wFrac * 100, heightPct: hFrac * 100 }
}

// The letterbox/pillarbox offset for a given mockup — the number that says how
// far this mockup's aspect is from the container's (0 = same ratio, no boxing).
export function letterboxInfo(
  naturalW: number,
  naturalH: number,
  containerW: number = CANVAS_W,
  containerH: number = CANVAS_H
) {
  const containerAspect = containerW / containerH
  const imageAspect = naturalW / naturalH
  if (imageAspect >= containerAspect) {
    const rhFrac = containerAspect / imageAspect
    return { imageAspect, containerAspect, mode: 'letterbox-top/bottom' as const, renderFrac: rhFrac, offset: (1 - rhFrac) / 2 }
  }
  const rwFrac = imageAspect / containerAspect
  return { imageAspect, containerAspect, mode: 'pillarbox-left/right' as const, renderFrac: rwFrac, offset: (1 - rwFrac) / 2 }
}
