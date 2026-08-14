import { describe, it, expect } from 'vitest'
import { bezierControlFromPeak, pathTextLayout } from '../app/lib/curvePath'

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

  it('lays glyphs on a horizontal line, centered, tangent ~0', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10, 10], 0)
    expect(r.scale).toBe(1)
    expect(r.pathLength).toBeCloseTo(100, 0)
    // widths 10,10,10 spacing 0 -> totalEff 30, centered on 100 -> starts at 35, centers at 40/50/60
    expect(r.glyphs.map(g => Math.round(g.x))).toEqual([40, 50, 60])
    r.glyphs.forEach(g => { expect(g.y).toBeCloseTo(0, 5); expect(Math.abs(g.angle)).toBeLessThan(1e-6) })
  })

  it('honors spacing between glyphs (spacing after each glyph)', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10], 10) // totalEff = 20 + 10*2 = 40, centered -> start 30
    // centers: 30+5=35, then advance 10+10 -> 55+5=... center2 = 30 + (10+10) + 5 = 55
    expect(r.glyphs.map(g => Math.round(g.x))).toEqual([35, 55])
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
    // the arc is longer than the 100px chord, so the text (40px) still fits with no shrink
    expect(r.pathLength).toBeGreaterThan(100)
    expect(r.scale).toBe(1)
  })
})

describe('pathTextLayout — auto-shrink', () => {
  const p0 = { x: 0, y: 0 }, p2 = { x: 100, y: 0 }
  const control = bezierControlFromPeak(p0, { x: 50, y: 0 }, p2) // straight, length 100

  it('shrinks to fit when the text overruns the path', () => {
    const r = pathTextLayout(p0, control, p2, [50, 50, 50, 50], 0) // totalEff 200 > 100
    expect(r.scale).toBeCloseTo(0.5, 5)
    // after shrink the run fills the whole path (0..100), centers at 25/75... 4 glyphs of eff-width 25
    expect(r.glyphs[0].x).toBeCloseTo(12.5, 1)
    expect(r.glyphs[3].x).toBeCloseTo(87.5, 1)
  })

  it('does not shrink when the text fits', () => {
    const r = pathTextLayout(p0, control, p2, [10, 10], 0)
    expect(r.scale).toBe(1)
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
