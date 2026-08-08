import { describe, it, expect } from 'vitest'
import { shade } from '../app/lib/embroideryLook'

// The Fabric render-override is exercised in the browser; `shade` is the pure, testable core — it drives
// the thread strand shading (dark edge / ink / light sheen), so bad math = wrong thread color.
describe('shade (thread strand tint)', () => {
  it('is a no-op at amount 0', () => {
    expect(shade('#808080', 0)).toBe('#808080')
    expect(shade('#b8902f', 0)).toBe('#b8902f')
  })
  it('lightens and darkens', () => {
    expect(shade('#808080', 16)).toBe('#909090')
    expect(shade('#808080', -16)).toBe('#707070')
  })
  it('clamps at the ends (never wraps)', () => {
    expect(shade('#000000', 255)).toBe('#ffffff')
    expect(shade('#ffffff', -255)).toBe('#000000')
    expect(shade('#ffffff', 40)).toBe('#ffffff')
    expect(shade('#000000', -40)).toBe('#000000')
  })
  it('always returns a valid 6-digit hex for real inks', () => {
    for (const ink of ['#b8902f', '#20305c', '#f2f2f2', '#9c1f24', '#1b2b4d']) {
      for (const amt of [-48, 62]) expect(shade(ink, amt)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
  it('passes through anything that is not a #rrggbb color (never throws)', () => {
    expect(shade('rgb(0,0,0)', 20)).toBe('rgb(0,0,0)')
    expect(shade('', 20)).toBe('')
    expect(shade('#abc', 20)).toBe('#abc')
  })
})
