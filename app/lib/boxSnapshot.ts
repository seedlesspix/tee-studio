// Neutral re-export of the two PURE print-box helpers that live under server/cutFileGeometry.ts, so
// the client designer (D2 Design Portability) can reconstruct a source box from a frozen
// design_orders.print_area snapshot without importing a `server/`-named module. cutFileGeometry is
// pure geometry (no DOM/DB/node) — see its header — so this is safe in a client bundle.
export {
  boxFromSnapshot,
  isSnapshot,
  MOCKUP_NATURAL,
  type PrintAreaSnapshot,
  type CanvasBox,
} from './server/cutFileGeometry'
