import { describe, it, expect } from 'vitest'
import { pickStaleOrders } from '../app/lib/staleOrders'
import { RETENTION_DAYS, STALE_CART_MIN_AGE_DAYS } from '../app/lib/retention'

const c = (id: string, status: string | null = 'cart_created') => ({ id, status, created_at: '2026-01-01T00:00:00Z' })

describe('pickStaleOrders — both exclusions fail closed, cap applies after them', () => {
  it('deletes only unsaved rows whose product is gone', () => {
    const r = pickStaleOrders({
      candidates: [c('a'), c('b'), c('c'), c('d', 'ordering')],
      savedIds: new Set(['b']),
      liveDesignIds: new Set(['c']),
      cap: 100,
    })
    expect(r.deletable).toEqual(['a', 'd'])
    expect(r.protectedBySavedDesigns).toBe(1)
    expect(r.protectedByLiveProduct).toBe(1)
    expect(r.deferredByCap).toBe(0)
  })
  it('never touches other statuses even if the caller passes them', () => {
    const r = pickStaleOrders({ candidates: [c('x', 'completed'), c('y', 'draft'), c('z', null)], savedIds: new Set(), liveDesignIds: new Set(), cap: 10 })
    expect(r.deletable).toEqual([])
  })
  it('caps and reports the deferred count', () => {
    const r = pickStaleOrders({ candidates: [c('1'), c('2'), c('3')], savedIds: new Set(), liveDesignIds: new Set(), cap: 2 })
    expect(r.deletable).toEqual(['1', '2'])
    expect(r.deferredByCap).toBe(1)
  })
  it('the stale window sits strictly beyond product retention', () => {
    expect(STALE_CART_MIN_AGE_DAYS).toBeGreaterThan(RETENTION_DAYS)
  })
})
