import { describe, it, expect } from 'vitest'
import { orderZones, deriveProductZones, isSleeveZone, isFallbackZone, zoneLabel } from '../app/lib/zones'

describe('orderZones', () => {
  it('sorts into canonical order regardless of input order', () => {
    expect(orderZones(['hat_back', 'front', 'right_sleeve', 'back', 'left_sleeve']))
      .toEqual(['front', 'back', 'left_sleeve', 'right_sleeve', 'hat_back'])
  })
  it('dedupes', () => {
    expect(orderZones(['front', 'front', 'back'])).toEqual(['front', 'back'])
  })
  it('puts unknown zones last, stable by name', () => {
    expect(orderZones(['sleeve_x', 'front', 'aaa'])).toEqual(['front', 'aaa', 'sleeve_x'])
  })
})

describe('deriveProductZones — no behavior change for today\'s products', () => {
  it('classic tee (front+back areas, back images) → [front, back]', () => {
    expect(deriveProductZones({ areaSides: ['front', 'back'], hasBackImages: true }))
      .toEqual(['front', 'back'])
  })
  it('front-only product (e.g. onesie, no back images) → [front]', () => {
    expect(deriveProductZones({ areaSides: ['front'], hasBackImages: false }))
      .toEqual(['front'])
  })
  it('back area present but no back images still yields back (area is enough)', () => {
    expect(deriveProductZones({ areaSides: ['front', 'back'], hasBackImages: false }))
      .toEqual(['front', 'back'])
  })
  it('hasBackImages but no back area still yields back (legacy gate)', () => {
    expect(deriveProductZones({ areaSides: ['front'], hasBackImages: true }))
      .toEqual(['front', 'back'])
  })
})

describe('deriveProductZones — new zones', () => {
  it('tee with both sleeves → [front, back, left_sleeve, right_sleeve]', () => {
    expect(deriveProductZones({ areaSides: ['front', 'back', 'left_sleeve', 'right_sleeve'], hasBackImages: true }))
      .toEqual(['front', 'back', 'left_sleeve', 'right_sleeve'])
  })
  it('hat with only a hat_back area → [front, hat_back] (front always, no back)', () => {
    expect(deriveProductZones({ areaSides: ['front', 'hat_back'], hasBackImages: false }))
      .toEqual(['front', 'hat_back'])
  })
  it('front is always present even if the template forgot a front area', () => {
    expect(deriveProductZones({ areaSides: ['left_sleeve'], hasBackImages: false }))
      .toEqual(['front', 'left_sleeve'])
  })
})

describe('zone classification helpers', () => {
  it('isSleeveZone', () => {
    expect(isSleeveZone('left_sleeve')).toBe(true)
    expect(isSleeveZone('right_sleeve')).toBe(true)
    expect(isSleeveZone('front')).toBe(false)
    expect(isSleeveZone('hat_back')).toBe(false)
  })
  it('isFallbackZone (front/back can use the Shopify photo)', () => {
    expect(isFallbackZone('front')).toBe(true)
    expect(isFallbackZone('back')).toBe(true)
    expect(isFallbackZone('left_sleeve')).toBe(false)
    expect(isFallbackZone('hat_back')).toBe(false)
  })
  it('zoneLabel', () => {
    expect(zoneLabel('left_sleeve')).toBe('Left Sleeve')
    expect(zoneLabel('hat_back')).toBe('Hat Back')
    expect(zoneLabel('front')).toBe('Front')
    expect(zoneLabel('weird')).toBe('weird')
  })
})

describe('deriveProductZones — method-aware (templated products)', () => {
  // The designer passes the ACTIVE method's area sides + isTemplated:true, so a product offers only the
  // zones its active method can actually print. Covers the four-product review spread.

  it('single-method tee, Print: front+back areas → [front, back] (unchanged)', () => {
    expect(deriveProductZones({ areaSides: ['front', 'back'], hasBackImages: true, isTemplated: true }))
      .toEqual(['front', 'back'])
  })

  it('dual-method tee in EMBROIDERY (front-only areas) → [front] — Back dropped even with a back photo', () => {
    expect(deriveProductZones({ areaSides: ['front'], hasBackImages: true, isTemplated: true }))
      .toEqual(['front'])
  })

  it('same dual-method tee back in PRINT (front+back areas) → [front, back] — Back restored', () => {
    expect(deriveProductZones({ areaSides: ['front', 'back'], hasBackImages: true, isTemplated: true }))
      .toEqual(['front', 'back'])
  })

  it('hat with front + hat_back areas in the active method → [front, hat_back] (unaffected)', () => {
    expect(deriveProductZones({ areaSides: ['front', 'hat_back'], hasBackImages: false, isTemplated: true }))
      .toEqual(['front', 'hat_back'])
  })

  it('print-only sleeve is dropped in a method whose areas lack it', () => {
    // active method has only front → no sleeve, no back, even though other methods/photos exist
    expect(deriveProductZones({ areaSides: ['front'], hasBackImages: true, isTemplated: true }))
      .toEqual(['front'])
    // active method includes the sleeve → it appears
    expect(deriveProductZones({ areaSides: ['front', 'left_sleeve'], hasBackImages: true, isTemplated: true }))
      .toEqual(['front', 'left_sleeve'])
  })

  it('non-templated (legacy) product still uses the back-photo signal', () => {
    expect(deriveProductZones({ areaSides: [], hasBackImages: true, isTemplated: false }))
      .toEqual(['front', 'back'])
    expect(deriveProductZones({ areaSides: [], hasBackImages: false, isTemplated: false }))
      .toEqual(['front'])
  })
})
