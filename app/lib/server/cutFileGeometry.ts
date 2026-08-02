// Cut-file geometry: reconstruct the print-area box in the 680×850 canvas coordinate
// space from the frozen design_orders.print_area_{side} snapshot — reusing the SAME
// contain transform (toPctContain) the live designer overlay uses, so the backend can
// never drift from what the customer saw. Pure (no DOM/DB), testable in Node.
import { toPctContain, CANVAS_W, CANVAS_H } from '../printAreaGeometry'

// The catalog is all 2000×2000 square mockups; the mockup natural size N is NOT stored
// on the order (the designer reads it from the product image at load). This constant is
// the backend's stand-in. If a non-2000 mockup ever ships, persist N on the order.
export const MOCKUP_NATURAL = 2000

export type PrintAreaSnapshot = {
  x_px: number; y_px: number; width_px: number; height_px: number
  width_in: number; height_in: number
}
export type CanvasBox = { left: number; top: number; width: number; height: number }

// Frozen snapshot -> print box in 680×850 canvas px, via the designer's own transform.
export function boxFromSnapshot(a: PrintAreaSnapshot, N = MOCKUP_NATURAL): CanvasBox {
  const pct = toPctContain(
    { x_px: a.x_px, y_px: a.y_px, width_px: a.width_px, height_px: a.height_px }, N, N,
  )
  return {
    left: (pct.xPct / 100) * CANVAS_W,
    top: (pct.yPct / 100) * CANVAS_H,
    width: (pct.widthPct / 100) * CANVAS_W,
    height: (pct.heightPct / 100) * CANVAS_H,
  }
}

// Guard: a usable snapshot must carry inches (non-templated orders don't — they used a
// legacy % metafield with no physical size, so no cut file is possible for them).
export function isSnapshot(v: unknown): v is PrintAreaSnapshot {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return ['x_px', 'y_px', 'width_px', 'height_px', 'width_in', 'height_in']
    .every(k => typeof o[k] === 'number')
}
