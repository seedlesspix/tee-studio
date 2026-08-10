// Shared curved-text arc geometry — the SINGLE source of truth for how a curved text's glyphs sit
// along an arc, so the on-screen preview (curvedArc.ts, canvas raster) and the production cut file
// (server/cutFileEngine.ts, opentype outlines) CANNOT drift apart again.
//
// They DID drift: on 2026-08-07 the preview switched to a true-degrees model (curveAmount = the
// subtended angle) while the cut engine kept an older radius model (radius = max(S*1.5, 800-|A|*7.5)),
// so every curved order was cut at a different arc than the customer approved — flatter at low angles,
// never a full ring at 360°. Both now call this one function; a parity test guards it.
//
// The caller supplies glyph advance widths IN RENDER ORDER (already reversed for curve-down), in the
// same px units as the font size, plus the per-glyph spacing in px. `curveAmount` is the signed slider
// value; its MAGNITUDE is the subtended arc in degrees (0..360). The sign (up vs down) is applied by
// the caller when it places/rotates each glyph — this returns only the sign-independent geometry:
// the shared radius, the total subtended angle (radians), and each glyph's CENTER angle along the arc.

export interface CurveArcGeometry {
  radius: number
  totalAngle: number   // radians
  angles: number[]     // per-glyph center angle, in render order
}

export function curveArcGeometry(
  orderedWidths: number[],
  spacingPx: number,
  curveAmount: number,
): CurveArcGeometry {
  const totalWidth = orderedWidths.reduce((a, b) => a + b, 0)
  // Arc length the glyphs (+ their inter-glyph spacing) occupy — sets the radius for the requested angle.
  const totalEff = totalWidth + spacingPx * orderedWidths.length
  // curveAmount magnitude IS the subtended angle in degrees; radius follows from arc length ÷ angle, so
  // the text ALWAYS spans exactly that many degrees. Clamp to a full circle; tiny floor guards a
  // near-zero divide (a ~0 value renders nearly straight instead of dividing by zero).
  const totalAngle = Math.max((Math.min(360, Math.abs(curveAmount)) * Math.PI) / 180, 1e-3)
  const radius = totalEff / totalAngle
  const angles: number[] = []
  let cur = -totalAngle / 2
  for (let i = 0; i < orderedWidths.length; i++) {
    // glyph center = current arc position + half of this glyph's own angular width
    angles.push(cur + (orderedWidths[i] / radius) / 2)
    // advance past this glyph AND its trailing spacing
    cur += (orderedWidths[i] + spacingPx) / radius
  }
  return { radius, totalAngle, angles }
}
