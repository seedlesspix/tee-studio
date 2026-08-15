// Type-on-path glyph placement — the SHARED geometry for a curved text that follows an ADMIN-DRAWN arc
// (the hat-back "type on path" model). Both the on-screen raster (curvedArc.ts) and the production cut
// file (server/cutFileEngine.ts) call this, so preview and cut can't drift — the same guarantee
// curveGeometry.ts gives the older fixed-degrees model.
//
// KEY DIFFERENCE from the degrees model: there, radius = textLength / fixedAngle, so curvature changes
// with text length (short text curls sharply). HERE the PATH is fixed (drawn per template on the mockup);
// the text FILLS the path — short words GROW to span it, long words shrink to fit — so it always spans the
// opening the way the drawn arc implies. The curvature belongs to the hat, not the text.
//
// SIGN CONVENTION (app-wide, matches the customer Curve slider + the degrees fallback): a POSITIVE curve
// is a FROWN ∩ (what sits over a cap opening); negative is a smile ∪. The path model itself carries NO
// signed number — the drawn bulge direction IS the shape (bulge above the endpoints = frown ∩, below =
// smile ∪) — but the "frown over the opening" intent is identical, so the two models never disagree.
//
// The path is a quadratic Bézier P0..C..P2 (C = control point). The admin draws 2 endpoints + a PEAK that
// lies ON the curve (the visual bulge); bezierControlFromPeak() converts that to C. We sample the curve to
// a polyline, walk it by arc length, center the run, auto-shrink to fit, and return each glyph's CENTER
// point + baseline tangent angle IN THE PATH'S COORDINATE SPACE. The caller translates to (x,y), rotates
// by angle, and draws the glyph centered (textAlign center, baseline middle) — same convention the
// circular renderer already uses. This function is unit-agnostic: control points and glyph widths must be
// in the same units (the designer uses canvas px).

export interface Pt { x: number; y: number }
export interface GlyphPlacement { x: number; y: number; angle: number } // angle radians = baseline tangent
export interface PathTextLayout {
  glyphs: GlyphPlacement[]
  scale: number       // ≤ 1 when the text was shrunk to fit the path length; the caller scales the font by it
  pathLength: number
}

// A PEAK point that lies ON the quadratic at t=0.5 → the Bézier control point. B(0.5) = (P0 + 2C + P2)/4,
// so C = 2·peak − (P0 + P2)/2. (A flatter peak → a wider, ovaler arc; a straight peak → a straight line.)
export function bezierControlFromPeak(p0: Pt, peak: Pt, p2: Pt): Pt {
  return { x: 2 * peak.x - (p0.x + p2.x) / 2, y: 2 * peak.y - (p0.y + p2.y) / 2 }
}

const SAMPLES = 256 // polyline resolution — fine enough that arc-length + tangent are smooth at print scale
const PATH_FILL = 0.9 // fraction of the arc the text spans (short words grow to this; long words shrink to fit)

function quadAt(p0: Pt, c: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y,
  }
}

// Sample the quadratic to a polyline + cumulative arc length (cum[i] = length from start to pts[i]).
function samplePath(p0: Pt, c: Pt, p2: Pt): { pts: Pt[]; cum: number[] } {
  const pts: Pt[] = []
  const cum: number[] = []
  let len = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const pt = quadAt(p0, c, p2, i / SAMPLES)
    if (i > 0) len += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y)
    pts.push(pt)
    cum.push(len)
  }
  return { pts, cum }
}

// Point + tangent angle at arc-length s along the polyline (s clamped to [0, total]).
function atLength(pts: Pt[], cum: number[], s: number): GlyphPlacement {
  const total = cum[cum.length - 1]
  const ss = Math.max(0, Math.min(total, s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < ss) i++
  const segLen = cum[i + 1] - cum[i] || 1
  const f = (ss - cum[i]) / segLen
  const a = pts[i], b = pts[i + 1]
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

// Lay `glyphWidths` (advance widths in render order) along the drawn quadratic path. Spacing matches the
// circular model exactly (spacingPx after EACH glyph → totalEff = Σwidth + spacing·n).
export function pathTextLayout(p0: Pt, control: Pt, p2: Pt, glyphWidths: number[], spacingPx: number): PathTextLayout {
  const { pts, cum } = samplePath(p0, control, p2)
  const pathLength = cum[cum.length - 1]
  if (!glyphWidths.length || pathLength <= 0) return { glyphs: [], scale: 1, pathLength }

  const totalWidth = glyphWidths.reduce((a, b) => a + b, 0)
  const totalEff = totalWidth + spacingPx * glyphWidths.length
  // FILL the path: scale the text so it spans (most of) the arc — short words GROW to fill it, long words
  // shrink to fit. Type-on-path's whole look is the text spanning the opening, not a small word floating at
  // the midpoint. PATH_FILL (<1) leaves a small margin so the ends sit just inside the drawn endpoints.
  const scale = totalEff > 0 ? (pathLength * PATH_FILL) / totalEff : 1
  const w = glyphWidths.map(g => g * scale)
  const sp = spacingPx * scale
  const effTotal = totalEff * scale // ≈ pathLength * PATH_FILL

  let s = (pathLength - effTotal) / 2 // center the run on the path
  const glyphs: GlyphPlacement[] = []
  for (let i = 0; i < w.length; i++) {
    glyphs.push(atLength(pts, cum, s + w[i] / 2)) // glyph CENTER sits on the path
    s += w[i] + sp
  }
  return { glyphs, scale, pathLength }
}
