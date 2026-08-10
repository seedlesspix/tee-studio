import { describe, it, expect } from 'vitest'
import { curveArcGeometry } from '../app/lib/curveGeometry'

// Guards the SINGLE arc model shared by the on-screen preview (curvedArc.ts) and the production cut
// file (cutFileEngine.ts). The two once drifted — the preview used a degrees model while the cut
// engine kept an old radius formula — so every curved order printed a different arc than approved.
describe('curveArcGeometry — shared preview↔cut arc model', () => {
  const widths = [30, 30, 30, 30] // 4 equal glyphs

  it('curveAmount magnitude IS the subtended angle in degrees', () => {
    for (const deg of [30, 90, 180, 360]) {
      const g = curveArcGeometry(widths, 0, deg)
      expect(g.totalAngle).toBeCloseTo((deg * Math.PI) / 180, 6)
    }
  })

  it('clamps to a full circle at 360° (and beyond)', () => {
    expect(curveArcGeometry(widths, 0, 720).totalAngle).toBeCloseTo(2 * Math.PI, 6)
  })

  it('glyph centers are symmetric about 0 and stay within the subtended angle', () => {
    const g = curveArcGeometry(widths, 0, 180) // totalAngle = π
    const first = g.angles[0], last = g.angles[g.angles.length - 1]
    expect(first).toBeCloseTo(-last, 6)          // symmetric about the arc center
    expect(last - first).toBeGreaterThan(0)
    expect(last - first).toBeLessThan(Math.PI)   // centers sit inside the sweep (half-glyph end caps)
  })

  it('the arc spans exactly totalAngle regardless of text width (wider → larger radius)', () => {
    const narrow = curveArcGeometry([10, 10], 0, 120)
    const wide = curveArcGeometry([80, 80, 80], 0, 120)
    expect(narrow.totalAngle).toBeCloseTo(wide.totalAngle, 6)
    expect(wide.radius).toBeGreaterThan(narrow.radius)
  })

  it('letter spacing lengthens the arc (larger radius for the same angle)', () => {
    const tight = curveArcGeometry(widths, 0, 120)
    const loose = curveArcGeometry(widths, 20, 120)
    expect(loose.radius).toBeGreaterThan(tight.radius)
  })

  it('is sign-independent — magnitude drives the geometry (caller applies up/down)', () => {
    const up = curveArcGeometry(widths, 0, 90)
    const down = curveArcGeometry(widths, 0, -90)
    expect(up.radius).toBeCloseTo(down.radius, 6)
    expect(up.totalAngle).toBeCloseTo(down.totalAngle, 6)
    expect(up.angles).toEqual(down.angles)
  })

  it('does NOT use the retired 800-|A|*7.5 radius model (which saturated past ~100°)', () => {
    // Old model: radius was ~flat once |A| > ~100 (floor at S*1.5). New model must keep shrinking
    // the radius as the angle grows for a fixed arc length, so 30° and 300° differ a lot.
    const shallow = curveArcGeometry(widths, 0, 30)
    const deep = curveArcGeometry(widths, 0, 300)
    expect(shallow.radius / deep.radius).toBeGreaterThan(5) // 300/30 = 10× tighter
  })
})
