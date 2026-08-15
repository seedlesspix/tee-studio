import { describe, it, expect } from 'vitest'
import { bezierControlFromPeak, pathTextLayout } from '../app/lib/curvePath'

// pathTextLayout FILLS the path: the text spans (most of) the arc — short words grow, long words shrink —
// so it always spans the opening the way the drawn arc implies. PATH_FILL=0.9 (a small end margin).

describe('bezierControlFromPeak', () => {
  it('derives the control so the peak lies ON the curve at t=0.5', () => {
    const p0 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 }, peak = { x: 50, y: 20 }
    const c = bezierControlFromPeak(p0, peak, p2)
    expect(c).toEqual({ x: 50, y: 40 })
    // B(0.5) = 0.25 P0 + 0.5 C + 0.25 P2 must equal the peak
    const mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p2.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p2.y }
    expect(mid.x).toBeCloseTo(peak.x)
    expect(mid.y).toBeCloseTo(peak.y)
  })
})

describe('pathTextLayout — straight path (control at midpoint)', () => {
  const p0 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 }
  const control = bezierControlFromPeak(p0, { x: 50, y: 0 }, p2) // straight line

  it('scales short text UP to fill the path, centered, tangent ~0', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10, 10], 0)
    // totalEff 30 grows to fill 0.9*100 = 90 -> scale 3; run centered (start 5), centers at 20/50/80
    expect(r.scale).toBeCloseTo(3, 5)
    expect(r.pathLength).toBeCloseTo(100, 0)
    expect(r.glyphs.map(g => Math.round(g.x))).toEqual([20, 50, 80])
    r.glyphs.forEach(g => { expect(g.y).toBeCloseTo(0, 5); expect(Math.abs(g.angle)).toBeLessThan(1e-6) })
  })

  it('honors spacing between glyphs (spacing after each glyph)', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10], 10) // totalEff 40 -> scale 2.25, fills to 90
    expect(r.glyphs.map(g => Math.round(g.x))).toEqual([16, 61])
    expect(r.glyphs[1].x).toBeGreaterThan(r.glyphs[0].x) // spaced apart
  })
})

describe('pathTextLayout — symmetric arc', () => {
  // Frown in screen coords (y-down): endpoints low, peak high (small y).
  const p0 = { x: 0, y: 100 }, p2 = { x: 100, y: 100 }
  const control = bezierControlFromPeak(p0, { x: 50, y: 0 }, p2)

  it('is symmetric about x=50 and dips toward the peak in the middle', () => {
    const r = pathTextLayout(p0, control, p2, [8, 8, 8, 8, 8], 0)
    const g = r.glyphs
    // mirror symmetry: first+last centers sum ~100, and their y match
    expect(g[0].x + g[4].x).toBeCloseTo(100, 0)
    expect(g[0].y).toBeCloseTo(g[4].y, 0)
    expect(g[1].x + g[3].x).toBeCloseTo(100, 0)
    // middle glyph sits near the top (smallest y = highest on screen)
    const minY = Math.min(...g.map(p => p.y))
    expect(g[2].y).toBeCloseTo(minY, 1)
    expect(g[2].x).toBeCloseTo(50, 0)
    // short text (40px) GROWS to fill the >100px arc
    expect(r.pathLength).toBeGreaterThan(100)
    expect(r.scale).toBeGreaterThan(1)
  })
})

describe('pathTextLayout — fill scaling', () => {
  const p0 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 }
  const control = bezierControlFromPeak(p0, { x: 50, y: 0 }, p2) // straight, length 100

  it('shrinks to fit when the text overruns the path', () => {
    const r = pathTextLayout(p0, control, p2, [50, 50, 50, 50], 0) // totalEff 200 -> scale 0.45
    expect(r.scale).toBeCloseTo(0.45, 5)
    // fills 0.9*100 = 90 (start 5): 4 glyphs of eff-width 22.5, centers 16.25 .. 83.75
    expect(r.glyphs[0].x).toBeCloseTo(16.25, 1)
    expect(r.glyphs[3].x).toBeCloseTo(83.75, 1)
  })

  it('GROWS short text to fill the path (the key type-on-path behavior)', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10], 0) // totalEff 20 -> scale 4.5
    expect(r.scale).toBeCloseTo(4.5, 5)
    expect(r.glyphs[0].x).toBeCloseTo(27.5, 1) // spans ~5..95, not a tiny word at the midpoint
    expect(r.glyphs[1].x).toBeCloseTo(72.5, 1)
  })
})

describe('pathTextLayout — degenerate', () => {
  it('empty text -> no glyphs', () => {
    const r = pathTextLayout({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, [], 0)
    expect(r.glyphs).toEqual([])
    expect(r.scale).toBe(1)
  })
  it('zero-length path -> no glyphs, no divide-by-zero', () => {
    const r = pathTextLayout({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, [10, 10], 0)
    expect(r.glyphs).toEqual([])
    expect(r.pathLength).toBe(0)
  })
})
