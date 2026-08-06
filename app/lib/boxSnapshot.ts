// Neutral re-export of the two PURE print-box helpers that live under server/cutFileGeometry.ts, so
// the client designer (D2 Design Portability) can reconstruct a source box from a frozen
// design_orders.print_area snapshot without importing a `server/`-named module. cutFileGeometry is
// pure geometry (no DOM/DB/node) — see its header — so this is safe in a client bundle.
import { CANVAS_W, CANVAS_H } from './printAreaGeometry'
import type { CanvasBox } from './server/cutFileGeometry'

export {
  boxFromSnapshot,
  isSnapshot,
  MOCKUP_NATURAL,
  type PrintAreaSnapshot,
  type CanvasBox,
} from './server/cutFileGeometry'

// The live designer holds the print area as PERCENTAGES of the 680×850 canvas (the `printArea` state /
// printAreaDataRef). Convert to the 680×850-px box the re-fit engine wants — this is how the TARGET
// product's box is obtained after it loads (the SOURCE box comes from boxFromSnapshot on the saved
// frozen snapshot). Same axis mapping boxFromSnapshot uses, so the two box sources agree.
export function boxFromPct(
  pct: { xPct: number; yPct: number; widthPct: number; heightPct: number },
): CanvasBox {
  return {
    left: (pct.xPct / 100) * CANVAS_W,
    top: (pct.yPct / 100) * CANVAS_H,
    width: (pct.widthPct / 100) * CANVAS_W,
    height: (pct.heightPct / 100) * CANVAS_H,
  }
}
