// Shared low-resolution math — the SINGLE source of truth for the customer's live upload warning
// (DesignerCanvas) and the bench flag in OrderInfo.txt (generateLayout). Both surfaces compute
// "placed inches" from their own data (the designer from getScaledWidth + the DOM print box; the
// bundle from scaleX × natural px + the frozen print box) then call these pure helpers, so the two
// can never disagree on whether a placement is at-risk. WARN only — never blocks an upload.

// Longest side below this (px) = a low-resolution FILE regardless of placement (Tier 1).
export const LOWRES_MIN_PX = 300
// Effective DPI at the placed size below this = blur risk at that size (Tier 2).
export const LOWRES_MIN_DPI = 150

// Placed size of one axis in inches: placed canvas px ÷ print-box px × the box's physical inches.
export function placedInches(placedPx: number, boxPx: number, inches: number): number {
  return boxPx > 0 ? (placedPx / boxPx) * inches : 0
}

// Effective DPI at the placed size, worst (lowest) axis = source px ÷ placed inches. Infinity when a
// placed dimension is non-positive (treated as "not at risk" — the caller has no real placement yet).
export function effectiveDpi(srcW: number, srcH: number, placedInW: number, placedInH: number): number {
  if (!(placedInW > 0) || !(placedInH > 0)) return Infinity
  return Math.min(srcW / placedInW, srcH / placedInH)
}

// Resolution tier for a raster placement:
//   'small'  — the source file itself is tiny (< LOWRES_MIN_PX longest side)
//   'placed' — fine file, but enlarged past LOWRES_MIN_DPI at this size
//   null     — fine
// 'small' wins over 'placed' (a tiny file is the more fundamental problem to report).
export function lowResTier(
  srcW: number, srcH: number, placedInW: number, placedInH: number,
): 'small' | 'placed' | null {
  if (!(srcW > 0) || !(srcH > 0)) return null
  if (Math.max(srcW, srcH) < LOWRES_MIN_PX) return 'small'
  const dpi = effectiveDpi(srcW, srcH, placedInW, placedInH)
  return Number.isFinite(dpi) && dpi < LOWRES_MIN_DPI ? 'placed' : null
}
