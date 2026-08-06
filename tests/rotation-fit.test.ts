import { describe, it, expect } from 'vitest'
import { maxScaleForRotation } from '../app/lib/rotationFit'

describe('maxScaleForRotation', () => {
  it('at angle 0 reduces to the plain box/size fit', () => {
    // 100x50 in a 400x400 box → limited by height: 400/50 = 8; width would allow 4 → min = 4
    expect(maxScaleForRotation(100, 50, 0, 400, 400)).toBeCloseTo(4)
  })

  it('at 90° the footprint swaps w and h', () => {
    // rotated 90°, a 100x50 object occupies 50 wide x 100 tall → limited by width now: 400/50=8, 400/100=4 → 4
    expect(maxScaleForRotation(100, 50, 90, 400, 400)).toBeCloseTo(4)
  })

  it('a square at 45° must shrink to ~1/√2 of the box (footprint = side·√2)', () => {
    // 100x100 square, box 200x200: at 0° maxScale = 2 (fills box). At 45° footprint per unit = 100·√2 ≈ 141.4,
    // so maxScale = 200/141.4 ≈ 1.414 → the square shrinks vs its unrotated box-fill.
    const at0 = maxScaleForRotation(100, 100, 0, 200, 200)
    const at45 = maxScaleForRotation(100, 100, 45, 200, 200)
    expect(at0).toBeCloseTo(2)
    expect(at45).toBeCloseTo(200 / (100 * Math.SQRT2))
    expect(at45).toBeLessThan(at0) // rotation forces a smaller max scale
  })

  it('is symmetric across the sign of the angle', () => {
    expect(maxScaleForRotation(120, 80, 30, 300, 300)).toBeCloseTo(maxScaleForRotation(120, 80, -30, 300, 300))
  })

  it('is 180°-periodic (a half turn has the same footprint)', () => {
    expect(maxScaleForRotation(120, 80, 20, 300, 300)).toBeCloseTo(maxScaleForRotation(120, 80, 200, 300, 300))
  })

  it('returns Infinity for a degenerate (zero) source size', () => {
    expect(maxScaleForRotation(0, 100, 30, 400, 400)).toBe(Infinity)
  })

  it('the rotated max is never larger than the unrotated max (rotation only ever tightens the cap)', () => {
    for (const angle of [10, 30, 45, 60, 75]) {
      expect(maxScaleForRotation(160, 90, angle, 500, 400))
        .toBeLessThanOrEqual(maxScaleForRotation(160, 90, 0, 500, 400) + 1e-9)
    }
  })
})
