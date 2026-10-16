import { describe, it, expect } from 'vitest'
import {
  parseDesignNumber, formatDesignNumber, parseGarmentRef, normalizeStyleToken, styleTokensOf, matchesStyle,
  methodsCompatible, stripDeepLinkParams, compareTemplates, bareProductId,
} from '../app/lib/deepLink'

describe('parseDesignNumber — "T2491" on the site means decal_number 2491', () => {
  it('accepts every tolerated spelling', () => {
    for (const s of ['T2491', 't2491', '2491', 'T-2491', 'T_2491', 'T 2491', ' T2491 ', '002491', 'T002491']) {
      expect(parseDesignNumber(s), s).toBe(2491)
    }
  })
  it('rejects garbage, empties, zero, and over-long numbers', () => {
    for (const s of ['', '   ', 'T', 'TT2491', '2491T', 'T24 91', 'abc', '0', 'T0', '1234567890', null, undefined]) {
      expect(parseDesignNumber(s as string), String(s)).toBeNull()
    }
  })
  it('formats back with the display-only T', () => {
    expect(formatDesignNumber(2491)).toBe('T2491')
  })
})

describe('style tokens — the &garment= vocabulary is the template style number', () => {
  it('normalizes case and separators', () => {
    expect(normalizeStyleToken(' 3413 y ')).toBe('3413Y')
    expect(normalizeStyleToken('bx-030')).toBe('BX030')
  })
  it('a combined admin entry answers to each part and to the whole', () => {
    expect(styleTokensOf('3413Y & 3413T')).toEqual(['3413Y3413T', '3413Y', '3413T'])
    expect(matchesStyle('3413Y & 3413T', '3413y')).toBe(true)
    expect(matchesStyle('3413Y & 3413T', '3413T')).toBe(true)
    expect(matchesStyle('3413Y & 3413T', '3413')).toBe(false) // the adult tee is a different template
  })
  it('drops stray one-character parts', () => {
    expect(styleTokensOf('3001T&Y')).toEqual(['3001TY', '3001T'])
    expect(matchesStyle('3001T&Y', 'Y')).toBe(false)
  })
  it('handles empty / null', () => {
    expect(styleTokensOf(null)).toEqual([])
    expect(matchesStyle(null, '3001')).toBe(false)
    expect(matchesStyle('3001', '')).toBe(false)
  })
})

describe('parseGarmentRef', () => {
  it('style token by default', () => {
    expect(parseGarmentRef('3001')).toEqual({ kind: 'style', token: '3001' })
    expect(parseGarmentRef(' bx031 ')).toEqual({ kind: 'style', token: 'BX031' })
  })
  it('template uuid', () => {
    expect(parseGarmentRef('A1B2C3D4-0000-4000-8000-123456789ABC')).toEqual({ kind: 'template', id: 'a1b2c3d4-0000-4000-8000-123456789abc' })
  })
  it('Shopify product id in gid, plural-typo gid, or bare long numeric form', () => {
    expect(parseGarmentRef('gid://shopify/Product/8765432109876')).toEqual({ kind: 'product', gid: 'gid://shopify/Product/8765432109876' })
    expect(parseGarmentRef('gid://shopify/Products/8765432109876')).toEqual({ kind: 'product', gid: 'gid://shopify/Product/8765432109876' })
    expect(parseGarmentRef('8765432109876')).toEqual({ kind: 'product', gid: 'gid://shopify/Product/8765432109876' })
  })
  it('a short all-digit value is a style number, not a product id', () => {
    expect(parseGarmentRef('39165')).toEqual({ kind: 'style', token: '39165' })
  })
  it('empty → null', () => {
    expect(parseGarmentRef('')).toBeNull()
    expect(parseGarmentRef('   ')).toBeNull()
    expect(parseGarmentRef(null)).toBeNull()
    expect(parseGarmentRef('---')).toBeNull()
  })
})

describe('methodsCompatible — hide garments that cannot produce the design (decision 6)', () => {
  it('needs one shared method', () => {
    expect(methodsCompatible(['screen_print'], ['screen_print', 'embroidery'])).toBe(true)
    expect(methodsCompatible(['screen_print'], ['embroidery'])).toBe(false)
    expect(methodsCompatible(['screen_print', 'embroidery'], ['embroidery'])).toBe(true)
  })
  it('fails open when either side is unknown', () => {
    expect(methodsCompatible([], ['embroidery'])).toBe(true)
    expect(methodsCompatible(null, ['embroidery'])).toBe(true)
    expect(methodsCompatible(['screen_print'], undefined)).toBe(true)
  })
})

describe('stripDeepLinkParams', () => {
  it('removes design + garment and keeps everything else', () => {
    const u = stripDeepLinkParams(new URL('https://x.test/designer?product_id=1&design=T2491&garment=3001&title=Tee&color=Black'))
    expect(u.search).toBe('?product_id=1&title=Tee&color=Black')
  })
})

describe('compareTemplates — deterministic "first" even when sort_order ties', () => {
  it('sort_order, then oldest, then name', () => {
    const rows = [
      { name: 'B', sort_order: 0, created_at: '2026-08-02' },
      { name: 'A', sort_order: 0, created_at: '2026-08-02' },
      { name: 'C', sort_order: 0, created_at: '2026-07-01' },
      { name: 'D', sort_order: 1, created_at: '2026-01-01' },
    ]
    expect([...rows].sort(compareTemplates).map(r => r.name)).toEqual(['C', 'A', 'B', 'D'])
  })
})

describe('bareProductId', () => {
  it('strips the gid prefix', () => {
    expect(bareProductId('gid://shopify/Product/123')).toBe('123')
    expect(bareProductId('')).toBe('')
  })
})
