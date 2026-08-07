import { describe, it, expect } from 'vitest'
import { currentTier, nextTier, normalizeTiers, type VolumeTier } from '../app/lib/volumeTiers'

const TIERS: VolumeTier[] = [
  { minQty: 6, pct: 10 },
  { minQty: 12, pct: 15 },
  { minQty: 24, pct: 20 },
]

describe('currentTier', () => {
  it('is null below the first threshold', () => {
    expect(currentTier(0, TIERS)).toBeNull()
    expect(currentTier(5, TIERS)).toBeNull()
  })
  it('returns the highest threshold met', () => {
    expect(currentTier(6, TIERS)?.pct).toBe(10)
    expect(currentTier(11, TIERS)?.pct).toBe(10)
    expect(currentTier(12, TIERS)?.pct).toBe(15)
    expect(currentTier(23, TIERS)?.pct).toBe(15)
    expect(currentTier(24, TIERS)?.pct).toBe(20)
    expect(currentTier(100, TIERS)?.pct).toBe(20)
  })
})

describe('normalizeTiers', () => {
  it('passes a clean array through', () => {
    expect(normalizeTiers(TIERS)).toEqual(TIERS)
  })
  it('parses a JSON string (the jsonb/metafield form)', () => {
    expect(normalizeTiers('[{"minQty":6,"pct":10},{"minQty":12,"pct":15}]')).toEqual([
      { minQty: 6, pct: 10 }, { minQty: 12, pct: 15 },
    ])
  })
  it('sorts ascending and de-dupes minQty (last wins)', () => {
    expect(normalizeTiers([{ minQty: 24, pct: 20 }, { minQty: 6, pct: 5 }, { minQty: 6, pct: 10 }])).toEqual([
      { minQty: 6, pct: 10 }, { minQty: 24, pct: 20 },
    ])
  })
  it('drops invalid rows (minQty<2, pct out of 1..99, non-numbers)', () => {
    expect(normalizeTiers([
      { minQty: 1, pct: 10 }, { minQty: 6, pct: 0 }, { minQty: 12, pct: 100 },
      { minQty: 'x', pct: 10 }, { minQty: 24, pct: 20 },
    ])).toEqual([{ minQty: 24, pct: 20 }])
  })
  it('returns [] for null/garbage', () => {
    expect(normalizeTiers(null)).toEqual([])
    expect(normalizeTiers('not json')).toEqual([])
    expect(normalizeTiers({})).toEqual([])
    expect(normalizeTiers(42)).toEqual([])
  })
})

describe('nextTier', () => {
  it('points at the first tier from zero', () => {
    expect(nextTier(0, TIERS)).toEqual({ tier: { minQty: 6, pct: 10 }, needed: 6 })
  })
  it('counts items needed to reach the next tier', () => {
    expect(nextTier(5, TIERS)).toEqual({ tier: { minQty: 6, pct: 10 }, needed: 1 })
    expect(nextTier(6, TIERS)).toEqual({ tier: { minQty: 12, pct: 15 }, needed: 6 })
    expect(nextTier(20, TIERS)).toEqual({ tier: { minQty: 24, pct: 20 }, needed: 4 })
  })
  it('is null at or past the top tier', () => {
    expect(nextTier(24, TIERS)).toBeNull()
    expect(nextTier(50, TIERS)).toBeNull()
  })
})
