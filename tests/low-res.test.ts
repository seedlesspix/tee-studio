import { describe, it, expect } from 'vitest'
import { LOWRES_MIN_PX, LOWRES_MIN_DPI, placedInches, effectiveDpi, lowResTier } from '../app/lib/lowRes'

describe('low-res: placedInches', () => {
  it('converts placed canvas px → inches via the box', () => {
    // half the box wide, box is 10in → 5in
    expect(placedInches(340, 680, 10)).toBeCloseTo(5)
  })
  it('is 0 for a non-positive box (no division blowup)', () => {
    expect(placedInches(100, 0, 10)).toBe(0)
  })
})

describe('low-res: effectiveDpi', () => {
  it('= source px ÷ placed inches, worst axis', () => {
    // 600px wide over 3in = 200 dpi; 600px tall over 6in = 100 dpi → worst 100
    expect(effectiveDpi(600, 600, 3, 6)).toBeCloseTo(100)
  })
  it('is Infinity when a placed dimension is non-positive', () => {
    expect(effectiveDpi(600, 600, 0, 6)).toBe(Infinity)
  })
})

describe('low-res: lowResTier', () => {
  it("flags 'small' when the source longest side is under 300px, regardless of placement", () => {
    // tiny 200px file placed small (would be high DPI) still reads as a small file
    expect(lowResTier(200, 150, 0.5, 0.4)).toBe('small')
  })
  it("'small' takes precedence even if placed DPI would be fine", () => {
    expect(lowResTier(299, 299, 1, 1)).toBe('small')
  })
  it("flags 'placed' when a big file is enlarged past 150 DPI", () => {
    // 3000px over 30in = 100 dpi
    expect(lowResTier(3000, 3000, 30, 30)).toBe('placed')
  })
  it('returns null when the file is big AND the placed DPI is fine', () => {
    // 3000px over 5in = 600 dpi
    expect(lowResTier(3000, 3000, 5, 5)).toBeNull()
  })
  it('null just above / placed just below the DPI threshold', () => {
    // exactly at the floor is NOT flagged (strictly below)
    expect(lowResTier(1500, 1500, 1500 / LOWRES_MIN_DPI, 1500 / LOWRES_MIN_DPI)).toBeNull()
    // a hair larger placement dips under the floor → flagged
    expect(lowResTier(1500, 1500, 1500 / LOWRES_MIN_DPI + 0.5, 1500 / LOWRES_MIN_DPI + 0.5)).toBe('placed')
  })
  it('300px longest side is the boundary (not "small"), then DPI decides', () => {
    // exactly 300px longest side → not 'small'; placed at 1in → 300 dpi → fine
    expect(lowResTier(300, 200, 1, 1)).toBeNull()
    // …but blow it up to 3in wide → 100 dpi → 'placed'
    expect(lowResTier(300, 200, 3, 2)).toBe('placed')
  })
  it('non-positive source dimensions → null (nothing to judge)', () => {
    expect(lowResTier(0, 0, 5, 5)).toBeNull()
  })
  it('constants are the agreed thresholds', () => {
    expect(LOWRES_MIN_PX).toBe(300)
    expect(LOWRES_MIN_DPI).toBe(150)
  })
})
